"""Real-database contract tests; no fixtures mutate the archive database."""
import csv
import datetime as dt
import http.client
import io
import json
import os
from pathlib import Path
import random
import sys
import tempfile
import threading
import tracemalloc
import unittest

APP=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APP))
from api_common import APIError, csv_chunks, json_default, rows
from api_service import Service
from server import ViewerServer

DB=Path(os.environ['LEGACY_TEST_DB']) if os.environ.get('LEGACY_TEST_DB') else None


@unittest.skipUnless(DB is not None and DB.is_file(), 'requires LEGACY_TEST_DB archive data')
class APIContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service=Service(DB)
        cls.temp=tempfile.TemporaryDirectory()
        ui=Path(cls.temp.name)
        (ui/'assets').mkdir()
        (ui/'index.html').write_text('<html>local UI</html>',encoding='utf-8')
        (ui/'assets'/'main-Abcd1234.js').write_text('const ok=1;',encoding='utf-8')
        cls.server=ViewerServer(('127.0.0.1',0),cls.service,ui)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        c=cls.service.con.cursor()
        cls.isrc=c.execute('select isrc from isrc_identity order by total_observations desc limit 1').fetchone()[0]
        cls.pid=c.execute('select playlist_id from pf_playlists order by readings desc limit 1').fetchone()[0]
        c.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        cls.service.close(); cls.temp.cleanup()

    def setUp(self): self.c=self.service.con.cursor()
    def tearDown(self): self.c.close()

    def api(self,path,p=None): return self.service.dispatch(self.c,path,p or {})

    def http(self,path,method='GET',headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=30)
        try:
            c.request(method,path,headers=headers or {})
            r=c.getresponse(); data=r.read()
            return r.status,dict(r.getheaders()),data
        finally: c.close()

    def test_catalog_five_random_dates_both_datasets(self):
        for dataset in ('stats2','stats'):
            expected=rows(self.c,'select day,streams from catalog_day where dataset=? order by day',[dataset])
            sampled=random.Random(20261004).sample(expected,5)
            result=self.api('/api/overview',{'dataset':dataset})
            by_day={r['bucket']:r for r in result['series']}
            for r in sampled:
                self.assertEqual(by_day[r['day']]['streams'],r['streams'])

    def test_bucket_last_and_summed_nets(self):
        for grain in ('week','month'):
            result=self.api('/api/overview',{'grain':grain})
            # Cumulative = last COMPLETE day's total in the bucket (partial collection days are blank).
            expected=rows(self.c,"select cast(date_trunc('"+grain+"',day) as date) bucket,arg_max(streams_complete,day) filter(where streams_complete is not null) streams,sum(daily_net) net,max(day) filter(where streams_complete is not null) streams_day from catalog_day where dataset='stats2' group by 1 order by 1")
            by_bucket={r['bucket']:r for r in result['series']}
            for row in expected:
                for key in ('streams','net','streams_day'): self.assertEqual(by_bucket[row['bucket']][key],row[key])

    def test_overview_artist_dictionary_matches_raw_readings(self):
        start,end=dt.date(2024,1,1),dt.date(2024,1,3)
        raw=self.c.execute('select distinct artist from src_tracks where created_at>=? and created_at<?',[start,end+dt.timedelta(days=1)]).fetchall()
        names={part.strip() for (artist,) in raw for part in artist.split(',')}
        dictionary={r[0] for r in self.c.execute('select artist_name from src_artists').fetchall()}
        result=self.api('/api/overview',{'from':str(start),'to':str(end)})
        self.assertEqual(result['kpis']['artists'],len(names & dictionary))

    def test_nulls_remain_null_in_http_json(self):
        day=self.c.execute("select day from catalog_day where dataset='stats2' and daily_net is null order by day limit 1").fetchone()[0]
        status,_,body=self.http('/api/overview?from='+str(day)+'&to='+str(day))
        self.assertEqual(status,200)
        series=json.loads(body)['series']
        self.assertIsNone(series[0]['net'])
        self.assertIn(b'"net":null',body)

    def test_gained_started_midrange_and_baseline_before_gap(self):
        entity=self.c.execute("select isrc,min(day) first_day from isrc_day where dataset='stats2' group by isrc having min(day)>'2024-01-01' order by first_day limit 1").fetchone()
        isrc,first=entity
        start=first-dt.timedelta(days=5); end=first+dt.timedelta(days=12)
        result=self.api('/api/tracks',{'from':str(start),'to':str(end),'q':isrc})['rows'][0]
        self.assertTrue(result['started_in_range'])
        values=self.c.execute("select arg_max(streams,day)-arg_min(streams,day) from isrc_day where dataset='stats2' and isrc=? and day between ? and ?",[isrc,start,end]).fetchone()[0]
        self.assertEqual(result['gained'],values)
        p={'from':str(first+dt.timedelta(days=5)),'to':str(end),'q':isrc}
        r=self.api('/api/tracks',p)['rows'][0]
        expected=self.c.execute("select arg_max(streams,day)-arg_max(streams,day) filter(where day<?) from isrc_day where dataset='stats2' and isrc=? and day<=?",[first+dt.timedelta(days=5),isrc,end]).fetchone()[0]
        self.assertFalse(r['started_in_range']); self.assertEqual(r['gained'],expected)

    def test_track_records_equal_db_and_linked_identity(self):
        result=self.api('/api/track/'+self.isrc)
        expected=rows(self.c,"select * from isrc_day where dataset='stats2' and isrc=? order by day",[self.isrc])
        self.assertEqual(result['records'],expected)
        self.assertEqual(len(result['identity']['per_id']),len(result['per_id']))
        self.assertTrue(all('names_seen' in r for r in result['identity']['per_id']))

    def test_followers_day_sum_raw_mode(self):
        # Independent recomputation from raw readings in plain Python: per playlist, most frequent
        # non-null reading of the UTC day, ties -> higher; then summed.
        import collections
        for day in (dt.date(2025,8,7), dt.date(2025,1,9)):
            raw=self.c.execute('select playlist_id,followers from pf_followers where timestamp>=? and timestamp<? and followers is not null',[day,day+dt.timedelta(days=1)]).fetchall()
            by=collections.defaultdict(collections.Counter)
            for pid,f in raw: by[pid][f]+=1
            expected=sum(max(c.items(), key=lambda kv:(kv[1],kv[0]))[0] for c in by.values())
            result=self.api('/api/followers/overview',{'from':str(day),'to':str(day)})
            self.assertEqual(result['series'][0]['total_followers'],expected)

    def test_accent_insensitive_noway(self):
        result=self.api('/api/tracks',{'q':'noway'})
        self.assertGreater(result['total'],0)
        self.assertTrue(any('Nøway' in r['artist'] for r in result['rows']))
        artists=self.api('/api/artists',{'q':'noway'})
        self.assertTrue(any(r['artist']=='Nøway' for r in artists['rows']))

    def test_sql_injection_and_validation(self):
        result=self.api('/api/tracks',{'q':"' OR 1=1; DROP TABLE isrc_day; --"})
        self.assertEqual(result['total'],0)
        with self.assertRaises(APIError): self.api('/api/tracks',{'sort':'streams; DROP TABLE isrc_day'})
        self.assertEqual(self.c.execute('select count(*) from isrc_identity').fetchone()[0],2667)
        for p in ({'dataset':'evil'},{'grain':'year'},{'from':'invalid'},{'dir':'desc; select 1'},{'limit':'-5'}):
            with self.assertRaises(APIError): self.api('/api/tracks',p)

    def test_csv_raw_streaming_bounded_memory(self):
        # This track has many raw rows; streaming never retains the completed CSV.
        query,params=self.service.export(self.c,{'view':'track','isrc':self.isrc,'raw':'1'})
        tracemalloc.start()
        byte_count=0; csv_rows=0; peak_first=0
        for index,chunk in enumerate(csv_chunks(self.c,query,params)):
            byte_count+=len(chunk)
            if index==0: self.assertEqual(chunk,b'\xef\xbb\xbf'); continue
            csv_rows+=sum(1 for _ in csv.reader(io.StringIO(chunk.decode('utf-8'))))
            if index==4: peak_first=tracemalloc.get_traced_memory()[1]
        _,peak=tracemalloc.get_traced_memory(); tracemalloc.stop()
        expected=self.c.execute('select count(*) from src_tracks s join isrc_map m using(spotify_track_id) where m.isrc=?',[self.isrc]).fetchone()[0]
        self.assertEqual(csv_rows-1,expected)
        self.assertGreater(expected,10000)
        self.assertLess(peak,3*1024*1024)
        print(json.dumps({'csv_raw_rows':expected,'csv_bytes':byte_count,'python_peak_bytes':peak,'early_peak_bytes':peak_first}))

    def test_all_export_views(self):
        for view in ('tracks','track','track_records','overview','artists','artist','playlists','playlist','milestones','followers_playlists','followers_playlist','quality_resets'):
            p={'view':view,'isrc':self.isrc,'name':'Lone Tusker','id':self.pid if view=='followers_playlist' else '0OwqBeZIh0JNJcIVobdtOz'}
            sql,params=self.service.export(self.c,p)
            chunks=csv_chunks(self.c,sql,params)
            self.assertEqual(next(chunks),b'\xef\xbb\xbf')
            self.assertTrue(next(chunks))
            chunks.close()
        status,headers,body=self.http('/api/export?view=tracks&q=noway')
        self.assertEqual(status,200); self.assertTrue(body.startswith(b'\xef\xbb\xbf'))
        self.assertIn('filename=',headers['Content-Disposition'])

    def test_http_security_and_static(self):
        status,_,body=self.http('/api/meta',headers={'Host':'evil.example'})
        self.assertEqual(status,403); self.assertIn('error',json.loads(body))
        self.assertEqual(self.http('/api/meta','PATCH',{'Host':'evil.example'})[0],403)
        self.assertEqual(self.http('/api/shutdown','POST',{'X-Viewer-Token':'invalid'})[0],403)
        self.assertEqual(self.http('/api/shutdown','POST',{'X-Viewer-Token':self.server.token,'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.http('/')[1]['Cache-Control'],'no-store')
        self.assertIn('immutable',self.http('/assets/main-Abcd1234.js')[1]['Cache-Control'])
        self.assertEqual(self.http('/%2e%2e/api_service.py')[0],403)
        self.assertEqual(self.http('/api/no_such_endpoint')[0],404)

    def test_ma7_calendar_window_partial_buckets(self):
        result=self.api('/api/overview')
        values={r['bucket']:r for r in result['series']}
        for day,row in list(values.items())[::23]:
            expected=self.c.execute("select case when count(daily_net)>=4 then avg(daily_net) end from catalog_day where dataset='stats2' and day between ? and ?",[day-dt.timedelta(days=6),day]).fetchone()[0]
            self.assertEqual(row['ma7'],expected)
        gaps=self.api('/api/quality')['calendar_gaps']
        self.assertGreater(len(gaps),0)
        for gap in gaps:
            self.assertIsNone(values[gap['from']]['streams'])
            self.assertEqual(values[gap['from']]['days_missing'],1)

    def test_lofi_predicate_and_numeric_ladder(self):
        result=self.api('/api/milestones',{'exclude_lofi':'1','limit':'5000'})
        banned=('joongle','dosa','piple','sad app','tsambar','dokha','five fi')
        self.assertTrue(all(not any(a in r['artist'].lower() for a in banned) for r in result['rows']))
        values=[r['value'] for r in result['summary']['ladder']]
        self.assertEqual(values,sorted(values))
        self.assertIn('Joongle',result['notes'][1])

    def test_remaining_endpoints_and_dataset_scopes(self):
        for path in ('/api/meta','/api/archive','/api/artists','/api/artist/Lone%20Tusker','/api/playlists','/api/playlist/0OwqBeZIh0JNJcIVobdtOz','/api/followers/playlists','/api/followers/accounts','/api/followers/playlist/'+self.pid):
            self.assertIsInstance(self.api(path),dict)
        day=self.c.execute("select min(day) from isrc_day where dataset='stats2' and isrc=?",[self.isrc]).fetchone()[0]
        r=self.api('/api/track/'+self.isrc+'/readings',{'day':str(day)})
        self.assertTrue(r['rows']); self.assertLessEqual(len(r['rows']),5000)
        for dataset in ('stats2','stats'):
            for grain in ('day','week','month'):
                self.assertTrue(self.api('/api/overview',{'dataset':dataset,'grain':grain,'scope':'releases_extended'})['series'])

    def test_quality_observations_include_all_linked_ids(self):
        for dataset,expected in (('stats2',34325689),('stats',27198862)):
            coverage=self.api('/api/quality',{'dataset':dataset})['coverage']
            self.assertEqual(sum(r['observations'] for r in coverage),expected)


if __name__=='__main__': unittest.main(verbosity=2)
