"""Original-mode HTTP fidelity contracts against the real read-only archive."""
import datetime as dt
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_common import APIError
from api_service import Service
from grafana_compat import frames_to_jsonable, run_panel
from server import ViewerServer

DB = Path(os.environ['LEGACY_TEST_DB']) if os.environ.get('LEGACY_TEST_DB') else None


@unittest.skipUnless(DB is not None and DB.is_file(), 'requires LEGACY_TEST_DB archive data')
class OriginalContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service(DB)
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = ViewerServer(('127.0.0.1', 0), cls.service, cls.temp.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        cls.service.close(); cls.temp.cleanup()

    def http(self, path, params=None):
        con = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=120)
        try:
            con.request('GET', path + ('?' + urlencode(params) if params else ''))
            response = con.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally: con.close()

    def get(self, path, params=None):
        status, _, data = self.http(path, params)
        self.assertEqual(status, 200, data[:1000])
        return json.loads(data)

    def test_all_dashboards_without_sql(self):
        data = self.get('/api/original/dashboards')
        self.assertEqual({d['key'] for d in data['dashboards']}, set(self.service.original.dashboards))
        self.assertNotIn('duckdb_sql', json.dumps(data))
        self.assertNotIn('original_sql', json.dumps(data))
        self.assertEqual(sum(d['starred'] for d in data['dashboards']), 3)
        pf = next(d for d in data['dashboards'] if d['server'] == 'pf')
        self.assertEqual(sum(len(r['panels']) for r in pf['rows']), 510)

    def test_frames_equal_compat_table_time_series_stat(self):
        con = self.service.con.cursor()
        try:
            for id in ('stats2.spotify-dash.33', 'stats2.spotify-dash.31', 'stats2.spotify-dash.90'):
                entry = self.service.original.panels[id]
                dashboard = self.service.original.dashboard(entry['dashboard_key'])
                expected = frames_to_jsonable(run_panel(con, entry, {}, dashboard['dataset'],
                    time_range=self.service.original.time_range(dashboard, {})))
                self.assertEqual(self.get('/api/original/panel', {'id': id})['frames'], expected)
        finally: con.close()

    def test_artist_and_cascading_track_options(self):
        params = {'dashboard': 'stats2.spotify-dash', 'name': 'artist_name'}
        self.assertIn('Joongle', {o['value'] for o in self.get('/api/original/variable-options', params)['options']})
        params['name'] = 'track_name'
        params['vars'] = json.dumps({'artist_name': 'Joongle'})
        first = self.get('/api/original/variable-options', params)['options']
        params['vars'] = json.dumps({'artist_name': os.environ["LEGACY_SAMPLE_ARTIST"]})
        second = self.get('/api/original/variable-options', params)['options']
        self.assertTrue(first); self.assertTrue(second); self.assertNotEqual(first, second)

    def test_pf_instance(self):
        entry = next(p for p in self.service.original.panels.values() if p.get('instances'))
        instance = entry['instances'][0]
        actual = self.get('/api/original/panel', {'id': entry['id'], 'instance': instance['panel_id']})
        con = self.service.con.cursor()
        try:
            expected = frames_to_jsonable(run_panel(con, entry, {'__account': instance['account_name'], '__playlist': instance['playlist_name']}, 'pf',
                time_range=self.service.original.time_range(self.service.original.dashboard('pf.playlist-followers'), {})))
        finally: con.close()
        self.assertEqual(actual['frames'], expected)
        self.assertTrue(actual['frames'][0]['rows'])

    def test_raw_one_day_count_and_stats_scope(self):
        con = self.service.con.cursor()
        try:
            for dataset in ('stats2', 'stats'):
                day = self.service.original.registry['datasets'][dataset]['anchor'][:10]
                params = {'dataset': dataset, 'from': day, 'to': day, 'limit': 2}
                direct = con.execute('select count(*) from src_tracks where created_at>=? and created_at<?' + (' and in_stats_dump' if dataset == 'stats' else ''),
                    [dt.date.fromisoformat(day), dt.date.fromisoformat(day) + dt.timedelta(days=1)]).fetchone()[0]
                self.assertEqual(self.get('/api/raw/observations', params)['total'], direct)
        finally: con.close()

    def test_cache_hit_identical_payload_and_utc(self):
        params = {'id': 'stats2.spotify-dash.31', 'from': '2025-12-01T04:00:00+04:00', 'to': '2025-12-20T00:00:00Z'}
        first = self.get('/api/original/panel', params)
        before = self.service.original.hits
        self.assertEqual(first, self.get('/api/original/panel', params))
        self.assertEqual(self.service.original.hits, before + 1)
        self.assertEqual(first['time_range']['from'], '2025-12-01T00:00:00+00:00')

    def test_export_streams_and_sql_drawer(self):
        for params in ({'view': 'original_panel', 'id': 'stats2.spotify-dash.33'},
                       {'view': 'raw_observations', 'from': '2025-12-22', 'to': '2025-12-22'},
                       {'view': 'raw_follower_readings', 'from': '2026-09-01', 'to': '2026-09-01'}):
            status, headers, data = self.http('/api/export', params)
            self.assertEqual(status, 200)
            self.assertEqual(headers['Transfer-Encoding'], 'chunked')
            self.assertTrue(data.startswith(b'\xef\xbb\xbf'))
            self.assertGreater(data.count(b'\n'), 2)
        sql = self.get('/api/original/panel-sql', {'id': 'stats2.spotify-dash.33'})
        self.assertTrue(sql['targets'][0]['original_sql']); self.assertGreater(sql['validation']['cases_passed'], 0)

    def test_validation_and_cap(self):
        for path, params in (('/api/original/panel', {'id': 'missing'}),
                             ('/api/original/panel', {'id': 'stats2.spotify-dash.31', 'vars': '[]'}),
                             ('/api/raw/observations', {'sort': 'id;drop table src_tracks'}),
                             ('/api/raw/observations', {'from': '2023-01-01', 'to': '2025-12-22'})):
            self.assertIn(self.http(path, params)[0], (400, 404))
        # The original alert frame has ~1.7M rows; its SQL remains unchanged.
        result = self.get('/api/original/panel', {'id': 'stats2.spotify-dash.117'})
        self.assertTrue(result['truncated'])
        self.assertTrue(any(len(f['rows']) == 50_000 for f in result['frames']))
        self.assertTrue(all(len(f['rows']) <= 50_000 for f in result['frames']))


if __name__ == '__main__': unittest.main()
