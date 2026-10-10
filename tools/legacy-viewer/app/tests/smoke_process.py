"""Launch real source/frozen processes, curl loopback, and token-shutdown them.

Only writes test logs outside the archive; requires Windows curl.exe for smoke.
"""
import argparse
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import time


def smoke(command,base,log,port=8765):
    base=Path(base);lock=base/'.viewer.json'
    if lock.exists(): raise RuntimeError('Refusing to interfere with existing lock: '+str(lock))
    occupied=socket.socket()
    try: occupied.bind(('127.0.0.1',port));occupied.listen()
    except OSError:
        # A pre-existing unrelated listener already exercises port fallback.
        # Leave that listener untouched.
        occupied.close()
    process=None;info=None
    report={}
    with Path(log).open('w',encoding='utf-8') as output:
        try:
            process=subprocess.Popen(command+['--no-browser','--port',str(port)],stdout=output,stderr=output)
            deadline=time.monotonic()+40
            while time.monotonic()<deadline:
                if process.poll() is not None: raise RuntimeError('Viewer exited '+str(process.returncode)+'; '+str(log))
                if lock.exists():
                    try:
                        info=json.loads(lock.read_text(encoding='utf-8'))
                        r=subprocess.run(['curl.exe','--silent','--show-error','--fail','--max-time','5',f"http://127.0.0.1:{info['port']}/api/meta"],capture_output=True,check=True)
                        meta=json.loads(r.stdout);break
                    except (OSError,ValueError,subprocess.SubprocessError): pass
                time.sleep(.1)
            else: raise RuntimeError('Viewer did not start')
            report['port']=info['port']; report['port_fallback']=info['port']!=port
            assert report['port_fallback']
            report['datasets']={d['key']:d['observations'] for d in meta['datasets']}
            report['followers_readings']=meta['followers']['readings']
            for endpoint in ('/api/overview','/api/tracks?q=noway','/api/followers/overview','/api/archive'):
                t=time.perf_counter()
                r=subprocess.run(['curl.exe','--silent','--show-error','--fail','--max-time','10',f"http://127.0.0.1:{info['port']}"+endpoint],capture_output=True,check=True)
                body=json.loads(r.stdout)
                report[endpoint]={'curl_seconds':round(time.perf_counter()-t,4),'bytes':len(r.stdout)}
            # A second process returns without creating a server or changing token.
            again=subprocess.run(command+['--no-browser'],capture_output=True,timeout=15)
            assert again.returncode==0,again.stderr
            assert json.loads(lock.read_text(encoding='utf-8'))==info
            report['single_instance']=True
            # Check hostile Host over a real socket, not just unit-test dispatch.
            r=subprocess.run(['curl.exe','--silent','--header','Host: evil.example','--write-out','%{http_code}',f"http://127.0.0.1:{info['port']}/api/meta"],capture_output=True,check=True)
            assert r.stdout.endswith(b'403');report['host_guard']=403
            session=subprocess.run(['curl.exe','--silent','--fail',f"http://127.0.0.1:{info['port']}/api/session"],capture_output=True,check=True)
            token=json.loads(session.stdout)['token']
            assert token==info['token']
            r=subprocess.run(['curl.exe','--silent','--fail','--request','POST','--header','X-Viewer-Token: '+token,f"http://127.0.0.1:{info['port']}/api/shutdown"],capture_output=True,check=True)
            assert json.loads(r.stdout)['ok']
            assert process.wait(timeout=15)==0
            assert not lock.exists()
            report['token_shutdown']=True
        finally:
            occupied.close()
            if process and process.poll() is None:
                # Even failed smoke uses token shutdown when possible.
                if info:
                    try:
                        c=http.client.HTTPConnection('127.0.0.1',info['port'],timeout=2)
                        c.request('POST','/api/shutdown',headers={'X-Viewer-Token':info['token']});c.getresponse().read();c.close();process.wait(timeout=10)
                    except Exception: pass
                if process.poll() is None: process.terminate();process.wait(timeout=10)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--exe',type=Path);p.add_argument('--db',type=Path);p.add_argument('--art',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.exe: command=[str(a.exe.resolve())];base=a.exe.resolve().parent;name='frozen'
    else:
        app=Path(__file__).resolve().parents[1]
        if a.db is None: p.error('--db is required for source smoke checks')
        command=[sys.executable,str(app/'server.py'),'--db',str(a.db.resolve())]
        if a.art: command += ['--art',str(a.art.resolve())]
        base=app.parent;name='source'
    report=smoke(command,base,a.output.with_suffix('.log'))
    a.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({name:report}))
