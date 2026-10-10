"""Portable local archive viewer. Runtime dependencies: stdlib and DuckDB only."""
import argparse
import ctypes
import errno
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
import webbrowser

from api_common import APIError, csv_chunks, json_default
from api_service import Service


def loopback_host(value,port):
    try:
        parsed=urlsplit('http://'+value)
        return (parsed.hostname in ('127.0.0.1','localhost','::1') and parsed.port==port
                and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment)
    except (ValueError,TypeError): return False


class ViewerServer(ThreadingHTTPServer):
    daemon_threads=False
    block_on_close=True
    allow_reuse_address=False

    def __init__(self,address,service,ui,token=None,art=None):
        self.service,self.ui=service,Path(ui).resolve()
        self.art=Path(art).resolve() if art else None
        self.token=token or secrets.token_urlsafe(32)
        self.active=True
        super().__init__(address,Handler)


class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def send_error(self,code,message=None,explain=None):
        self.close_connection=True
        if code==501 and hasattr(self,'headers') and not self.guard(): return
        self.json({'error':message or self.responses.get(code,('Request error',))[0]},code)

    def log_message(self,fmt,*args):
        if sys.stderr: print(fmt % args,file=sys.stderr)

    def json(self,value,status=200):
        data=json.dumps(value,default=json_default,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        if self.command!='HEAD': self.wfile.write(data)

    def guard(self):
        values=self.headers.get_all('Host',[])
        if len(values)!=1 or not loopback_host(values[0],self.server.server_port):
            self.close_connection=True
            self.json({'error':'Non-loopback Host refused'},403); return False
        return True

    def do_GET(self): self.read_request()
    def do_HEAD(self): self.read_request()

    def read_request(self):
        if not self.guard(): return
        cursor=None
        try:
            url=urlsplit(self.path)
            params={k:v[-1] for k,v in parse_qs(url.query,keep_blank_values=True,max_num_fields=100).items()}
            path=url.path
            if path=='/api/session': self.json({'token':self.server.token}); return
            if path.startswith('/api/'):
                cursor=self.server.service.con.cursor()
                if path=='/api/export':
                    if params.get('view') in ('original_panel','raw_observations','raw_follower_readings'):
                        chunks=self.server.service.original.export_chunks(cursor,params)
                    else:
                        chunks=csv_chunks(cursor,*self.server.service.dispatch(cursor,path,params))
                    # Execute before headers so invalid SQL/parameters remain JSON errors.
                    first=next(chunks)
                    self.send_response(200)
                    self.send_header('Content-Type','text/csv; charset=utf-8')
                    self.send_header('Content-Disposition','attachment; filename="legacy-'+params['view']+'.csv"')
                    self.send_header('Cache-Control','no-store')
                    self.send_header('X-Content-Type-Options','nosniff')
                    self.send_header('Transfer-Encoding','chunked')
                    self.end_headers()
                    if self.command=='HEAD': return
                    for chunk in (first,): self.send_chunk(chunk)
                    for chunk in chunks: self.send_chunk(chunk)
                    self.wfile.write(b'0\r\n\r\n')
                else: self.json(self.server.service.dispatch(cursor,path,params))
                return
            if path.startswith('/art/'): self.artwork(path); return
            self.static(path)
        except APIError as error: self.json({'error':str(error)},error.status)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError): pass
        except (ValueError,UnicodeError) as error: self.json({'error':str(error)},400)
        except Exception:
            if sys.stderr: traceback.print_exc()
            self.json({'error':'Internal query error; see server log'},500)
        finally:
            if cursor: cursor.close()

    def send_chunk(self,chunk):
        self.wfile.write(('%x\r\n'%len(chunk)).encode('ascii')+chunk+b'\r\n')

    def artwork(self,path):
        """Small cached JPEG thumbnails: /art/tracks/<isrc>.jpg, /art/artists/<id>.jpg only."""
        path=unquote(path)
        if '\x00' in path or '\\' in path: raise APIError('Invalid path',400)
        root=self.server.art
        if root is None: raise APIError('File not found',404)
        target=(root / path[len('/art/'):]).resolve()
        if not target.is_relative_to(root): raise APIError('Path outside artwork folder',403)
        if target.suffix.lower()!='.jpg' or not target.is_file(): raise APIError('File not found',404)
        self.send_response(200)
        self.send_header('Content-Type','image/jpeg')
        self.send_header('Content-Length',str(target.stat().st_size))
        self.send_header('Cache-Control','public, max-age=31536000, immutable')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        if self.command!='HEAD':
            with target.open('rb') as file: shutil.copyfileobj(file,self.wfile,64*1024)

    def static(self,path):
        path=unquote(path)
        if '\x00' in path or '\\' in path: raise APIError('Invalid path',400)
        target=(self.server.ui / path.lstrip('/')).resolve()
        if not target.is_relative_to(self.server.ui): raise APIError('Path outside UI',403)
        if target.is_dir(): target=(target/'index.html').resolve()
        if not target.is_file():
            if Path(path).suffix: raise APIError('File not found',404)
            target=(self.server.ui/'index.html').resolve()
        if not target.is_relative_to(self.server.ui): raise APIError('Path outside UI',403)
        if not target.is_file():
            raise APIError('UI dist is missing. Build ui/dist or supply --ui.',503)
        mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'}.get(target.suffix.lower(),mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
        import re
        hashed=target.parent.name=='assets' and bool(re.search(r'[-.][A-Za-z0-9_-]{8,}\.',target.name))
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(target.stat().st_size))
        self.send_header('Cache-Control','public, max-age=31536000, immutable' if hashed and target.name!='index.html' else 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        if self.command!='HEAD':
            with target.open('rb') as file: shutil.copyfileobj(file,self.wfile,64*1024)

    def do_POST(self):
        if not self.guard(): return
        self.close_connection=True
        if urlsplit(self.path).path!='/api/shutdown': self.json({'error':'Endpoint not found'},404); return
        origin=self.headers.get('Origin')
        if origin:
            try:
                parsed=urlsplit(origin)
                valid=parsed.scheme=='http' and loopback_host(parsed.netloc,self.server.server_port) and not parsed.path and not parsed.query and not parsed.fragment
                valid=valid and parsed.netloc.lower()==self.headers['Host'].lower()
            except ValueError: valid=False
            if not valid: self.json({'error':'Non-loopback or mismatched Origin refused'},403); return
        supplied=self.headers.get('X-Viewer-Token','')
        if not hmac.compare_digest(supplied.encode('utf-8'),self.server.token.encode('utf-8')):
            self.json({'error':'Invalid viewer token'},403); return
        self.json({'ok':True})
        threading.Thread(target=self.server.shutdown,daemon=True).start()


WINDOW_SIZE=(1600,1000)


def window_geometry(work_area,want=WINDOW_SIZE):
    """(width, height, x, y) for the app window: the wanted size clamped to the screen's work
    area (leaving a small margin) and centred. `work_area` = (left, top, width, height) or None."""
    if not work_area: return want[0],want[1],None,None
    left,top,width,height=work_area
    w=max(640,min(want[0],int(width*0.97)))
    h=max(480,min(want[1],int(height*0.97)))
    return w,h,left+max(0,(width-w)//2),top+max(0,(height-h)//2)


def screen_work_area():
    """Primary monitor work area (excludes the taskbar), or None when it cannot be read."""
    if os.name!='nt': return None
    try:
        class RECT(ctypes.Structure): _fields_=[(n,ctypes.c_long) for n in ('left','top','right','bottom')]
        rect=RECT()
        if not ctypes.windll.user32.SystemParametersInfoW(48,0,ctypes.byref(rect),0): return None  # SPI_GETWORKAREA
        return rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top
    except (OSError,AttributeError): return None


def window_flags():
    w,h,x,y=window_geometry(screen_work_area())
    flags=['--window-size=%d,%d'%(w,h)]
    if x is not None: flags.append('--window-position=%d,%d'%(x,y))
    return flags


def open_window(url):
    flags=window_flags()
    paths=[Path(os.environ.get(var,''))/'Microsoft'/'Edge'/'Application'/'msedge.exe' for var in ('PROGRAMFILES(X86)','PROGRAMFILES','LOCALAPPDATA')]
    for path in paths:
        if path.is_file():
            try:
                subprocess.Popen([str(path),'--app='+url,*flags]); return
            except OSError: pass
    if os.name=='nt':
        try:
            # shell builtin fallback; URL is constructed from an integer port.
            subprocess.run(['cmd','/c','start','','msedge','--app='+url,*flags],check=True,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
            return
        except (OSError,subprocess.SubprocessError): pass
    webbrowser.open(url)


def existing(lock):
    try:
        value=json.loads(lock.read_text(encoding='utf-8'))
        port=int(value['port'])
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=1)
        try:
            conn.request('GET','/api/session')
            response=conn.getresponse()
            token=json.loads(response.read())['token'] if response.status==200 else ''
            return value if hmac.compare_digest(token,value['token']) else None
        finally: conn.close()
    except (OSError,ValueError,KeyError,http.client.HTTPException): return None


def acquire_mutex(base):
    """Kernel mutex prevents competing launches and is released on process death."""
    if os.name!='nt': return None
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p]
    kernel.CreateMutexW.restype=ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint32]
    kernel.ReleaseMutex.argtypes=[ctypes.c_void_p]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    name='Local\\StreamBaseLegacyViewer-'+hashlib.sha256(str(base).lower().encode()).hexdigest()[:24]
    handle=kernel.CreateMutexW(None,False,name)
    if not handle: raise OSError(ctypes.get_last_error(),'CreateMutex failed')
    return kernel,handle


def lock_path(base):
    """The lock lives next to the EXE; on read-only media (e.g. a write-protected USB drive)
    fall back to a per-user location keyed by the package folder."""
    probe=base/'.viewer.write-test'
    try:
        probe.write_text('x',encoding='utf-8'); probe.unlink()
        return base/'.viewer.json'
    except OSError:
        folder=Path(os.environ.get('LOCALAPPDATA') or Path.home())/'StreamBaseLegacyViewer'
        folder.mkdir(parents=True,exist_ok=True)
        return folder/(hashlib.sha256(str(base).lower().encode()).hexdigest()[:24]+'.json')


def main(argv=None):
    frozen=getattr(sys,'frozen',False)
    base=Path(sys.executable).resolve().parent if frozen else Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',type=Path,default=base/'data'/'legacy_archive.duckdb' if frozen else None, required=not frozen)
    parser.add_argument('--ui',type=Path,default=base/'ui' if frozen else base/'ui'/'dist')
    parser.add_argument('--art',type=Path,default=base/'art' if frozen else None,
                        help='folder with the cached artwork thumbnails (tracks/, artists/); missing = initials tiles')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--instance-dir',type=Path,help='folder for the single-instance lock (default: next to the viewer); lets a separate test instance run beside the real one')
    args=parser.parse_args(argv)
    if not 0<=args.port<=65535: parser.error('port must be 0..65535')
    if args.instance_dir: args.instance_dir.mkdir(parents=True,exist_ok=True)
    lock_base=args.instance_dir.resolve() if args.instance_dir else base
    lock=lock_path(lock_base)
    mutex=acquire_mutex(lock_base)
    owned=False
    server=service=None
    try:
        running=existing(lock)
        if running:
            if not args.no_browser: open_window('http://127.0.0.1:'+str(running['port'])+'/')
            return 0
        if mutex:
            kernel,handle=mutex
            status=kernel.WaitForSingleObject(handle,0)
            if status not in (0,128):
                for _ in range(100):
                    running=existing(lock)
                    if running:
                        if not args.no_browser: open_window('http://127.0.0.1:'+str(running['port'])+'/')
                        return 0
                    time.sleep(.1)
                raise RuntimeError('Another viewer is starting; try again shortly')
            owned=True
        art=args.art.resolve() if args.art is not None and args.art.is_dir() else None
        service=Service(args.db.resolve(),art)
        try: server=ViewerServer(('127.0.0.1',args.port),service,args.ui,art=art)
        except OSError as error:
            if error.errno not in (errno.EADDRINUSE,10048): raise
            server=ViewerServer(('127.0.0.1',0),service,args.ui,art=art)
        value={'port':server.server_port,'pid':os.getpid(),'token':server.token}
        temp=lock.with_suffix('.json.tmp')
        temp.write_text(json.dumps(value),encoding='utf-8'); os.replace(temp,lock)
        url='http://127.0.0.1:'+str(server.server_port)+'/'
        if sys.stdout: print('Serving '+url,flush=True)
        if not args.no_browser: open_window(url)
        threading.Thread(target=service.warm, name='panel-warmup', daemon=True).start()
        server.serve_forever(poll_interval=.2)
        return 0
    except KeyboardInterrupt: return 0
    finally:
        if server:
            server.server_close()
            try:
                if json.loads(lock.read_text(encoding='utf-8')).get('token')==server.token: lock.unlink()
            except (OSError,ValueError): pass
        if service: service.close()
        if mutex:
            if owned: mutex[0].ReleaseMutex(mutex[1])
            mutex[0].CloseHandle(mutex[1])


if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        if sys.stderr: traceback.print_exc()
        elif os.name=='nt': ctypes.windll.user32.MessageBoxW(None,str(error),'StreamBase Legacy Viewer',0x10)
        raise SystemExit(1)
