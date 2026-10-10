"""Measure cold (new shared DB instance per endpoint) and warm complete views.

Cold here means cold service/connection, not flushing the Windows filesystem cache.
Export timings fully drain the streamed CSV. No archive modifications.
"""
import argparse
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from api_common import csv_chunks, json_default
from api_service import Service


def measure(db,output):
    s=Service(db); c=s.con.cursor()
    isrc=c.execute('select isrc from isrc_identity order by total_observations desc limit 1').fetchone()[0]
    day=str(c.execute("select min(day) from isrc_day where dataset='stats2' and isrc=?",[isrc]).fetchone()[0])
    pid=c.execute('select playlist_id from pf_playlists order by readings desc limit 1').fetchone()[0]
    c.close();s.close()
    endpoints=[('/api/meta',{}),('/api/session',{}),('/api/overview',{}),('/api/tracks',{}),('/api/track/'+isrc,{}),
      ('/api/track/'+isrc+'/readings',{'day':day}),('/api/artists',{}),('/api/artist/Lone%20Tusker',{}),
      ('/api/playlists',{}),('/api/playlist/0OwqBeZIh0JNJcIVobdtOz',{}),('/api/milestones',{}),
      ('/api/followers/overview',{}),('/api/followers/playlists',{}),('/api/followers/playlist/'+pid,{}),
      ('/api/followers/accounts',{}),('/api/quality',{}),('/api/archive',{})]
    for view in ('tracks','track','track_records','overview','artists','artist','playlists','playlist','milestones','followers_playlists','followers_playlist','quality_resets'):
        endpoints.append(('/api/export',{'view':view,'isrc':isrc,'name':'Lone Tusker','id':pid if view=='followers_playlist' else '0OwqBeZIh0JNJcIVobdtOz'}))
    result=[]
    for path,p in endpoints:
        s=Service(db)
        times=[];size=0
        for _ in range(2):
            c=s.con.cursor(); t=time.perf_counter()
            if path=='/api/session': size=len(json.dumps({'token':'x'*43}))
            elif path=='/api/export': size=sum(len(chunk) for chunk in csv_chunks(c,*s.export(c,p)))
            else: size=len(json.dumps(s.dispatch(c,path,p),default=json_default,separators=(',',':')).encode('utf-8'))
            times.append(round(time.perf_counter()-t,4)); c.close()
        s.close()
        r={'endpoint':path+(' ['+p['view']+']' if path=='/api/export' else ''),'cold_seconds':times[0],'warm_seconds':times[1],'response_bytes':size}
        result.append(r);print(json.dumps(r),flush=True)
    report={'cold_definition':'new DB/service per endpoint; OS file cache not flushed','endpoints':result,'slowest_five':sorted(result,key=lambda r:r['warm_seconds'],reverse=True)[:5]}
    Path(output).write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();measure(a.db,a.output)
