"""Lookup contracts cross-checked against the real, read-only archive."""
import datetime as dt
import http.client
import os
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_common import APIError, Context, csv_chunks, rows
from api_service import Service
from server import ViewerServer

DB = Path(os.environ['LEGACY_TEST_DB']) if os.environ.get('LEGACY_TEST_DB') else None


@unittest.skipUnless(DB is not None and DB.is_file(), 'requires LEGACY_TEST_DB archive data')
class LookupContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service(DB)
        cls.server = ViewerServer(('127.0.0.1', 0), cls.service, Path(__file__).parents[2] / 'ui' / 'dist')
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.service.close()

    def setUp(self): self.c = self.service.con.cursor()
    def tearDown(self): self.c.close()

    def api(self, endpoint, **p): return self.service.dispatch(self.c, '/api/lookup/' + endpoint, p)

    def direct(self, dataset, isrc, day):
        r = self.c.execute('select day,streams from isrc_day where dataset=? and isrc=? and day<=? order by day desc limit 1', [dataset, isrc, day]).fetchone()
        return r or self.c.execute('select day,streams from isrc_day where dataset=? and isrc=? order by day limit 1', [dataset, isrc]).fetchone()

    def test_dreams_owner_example(self):
        for dataset in ('stats2', 'stats'):
            p = {'dataset': dataset, 'isrc': 'SE6QE2204745', 'from': '2025-03-01', 'to': '2025-03-31'}
            r = self.api('between', **p)
            for side in ('from', 'to'):
                day, value = self.direct(dataset, p['isrc'], dt.date.fromisoformat(p[side]))
                self.assertEqual((r[side]['used_day'], r[side]['streams']), (day, value))
            self.assertEqual(r['difference'], r['to']['streams'] - r['from']['streams'])
            if dataset == 'stats2':
                exact = self.c.execute("select arg_max(streams,day)-arg_min(streams,day) from isrc_day where dataset='stats2' and isrc=? and day in ('2025-03-01','2025-03-31')", [p['isrc']]).fetchone()[0]
                self.assertFalse(r['from']['substituted']); self.assertFalse(r['to']['substituted'])
                self.assertEqual(r['difference'], exact)

    def test_substitution_and_gap(self):
        isrc, previous, after = self.c.execute("select isrc,prev_day,day from isrc_day where dataset='stats2' and prev_day<day-1 order by day,isrc limit 1").fetchone()
        start = previous + dt.timedelta(days=1)
        r = self.api('between', isrc=isrc, **{'from': str(start), 'to': str(after)})
        self.assertTrue(r['from']['substituted']); self.assertFalse(r['from']['before_tracking'])
        self.assertEqual(r['from']['used_day'], previous)
        count = self.c.execute("select count(*) from isrc_day where dataset='stats2' and isrc=? and day>? and day<=?", [isrc, previous, after]).fetchone()[0]
        self.assertEqual(r['gap_days'], (after - previous).days - count)
        self.assertGreater(r['gap_days'], 0)
        self.assertEqual(r['per_day'], r['difference'] / r['days'])

    def test_before_tracking_zero_days_and_empty_span(self):
        isrc, first = self.c.execute("select isrc,min(day) f from isrc_day where dataset='stats2' group by isrc order by f desc limit 1").fetchone()
        before = first - dt.timedelta(days=10)
        r = self.api('between', isrc=isrc, **{'from': str(before), 'to': str(first)})
        self.assertTrue(r['from']['before_tracking']); self.assertTrue(r['from']['substituted'])
        self.assertEqual(r['from']['used_day'], first); self.assertEqual(r['difference'], 0)
        self.assertEqual(r['days'], 0); self.assertIsNone(r['per_day'])
        empty = self.api('between', isrc=isrc, **{'from': str(before), 'to': str(before)})
        self.assertTrue(empty['empty']); self.assertIsNone(empty['difference'])
        # Known identity with no observations in stats must also be explicit.
        missing = self.c.execute("select isrc from isrc_identity where isrc not in (select distinct isrc from isrc_day where dataset='stats') limit 1").fetchone()[0]
        empty = self.api('between', dataset='stats', isrc=missing, **{'from': '2025-01-01', 'to': '2025-01-02'})
        self.assertTrue(empty['empty']); self.assertIsNone(empty['from'])

    def test_reversed_range_http_400_and_required_parameters(self):
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        c.request('GET', '/api/lookup/between?isrc=SE6QE2204745&from=2025-03-31&to=2025-03-01')
        response = c.getresponse(); self.assertEqual(response.status, 400); response.read(); c.close()
        for p in ({}, {'isrc': 'SE6QE2204745'}, {'isrc': 'SE6QE2204745', 'from': 'bad', 'to': '2025-01-01'}):
            with self.assertRaises(APIError): self.api('between', **p)

    def test_reset_inside_used_range(self):
        isrc, previous, day = self.c.execute("select isrc,prev_day,day from isrc_day where dataset='stats2' and is_reset order by day,isrc limit 1").fetchone()
        r = self.api('between', isrc=isrc, **{'from': str(previous), 'to': str(day)})
        self.assertIn(day, r['resets']); self.assertLess(r['difference'], 0)
        self.assertEqual(r['difference'], self.direct('stats2', isrc, day)[1] - self.direct('stats2', isrc, previous)[1])

    def test_artists_membership_search_order_and_dataset(self):
        for dataset in ('stats2', 'stats'):
            artists = self.api('artists', dataset=dataset)['rows']
            from api_lookup import normalized
            self.assertEqual(artists, sorted(artists, key=lambda a: (normalized(a['name']), a['name'])))
            self.assertTrue(all(a['track_count'] > 0 for a in artists))
            for a in artists[::max(1, len(artists)//30)]:
                tracks = self.api('tracks', dataset=dataset, artist=a['name'])['rows']
                self.assertEqual(a['track_count'], len(tracks))
                self.assertEqual(a['latest_total'], sum(t['latest_streams'] for t in tracks))
                self.assertEqual(tracks, sorted(tracks, key=lambda t: (normalized(t['song_name']), t['song_name'], t['isrc'])))
                self.assertTrue(all(a['name'] in [n.strip() for n in t['artist'].split(',')] for t in tracks))
            self.assertTrue(any(a['name'] == 'Nøway' for a in self.api('artists', dataset=dataset, q='NOWAY')['rows']))

    def test_track_picker_is_alphabetical_by_title_and_keeps_disambiguators(self):
        from api_lookup import normalized
        busiest = max(self.api('artists')['rows'], key=lambda a: a['track_count'])
        tracks = self.api('tracks', artist=busiest['name'])['rows']
        self.assertGreater(len(tracks), 20)
        keys = [(normalized(t['song_name']), t['song_name'], t['isrc']) for t in tracks]
        self.assertEqual(keys, sorted(keys))
        # first_day and the full credit stay in the rows: the picker's disambiguator needs them.
        self.assertTrue(all('first_day' in t and 'artist' in t for t in tracks))

    def test_monthly_milestones_match_track_detail_semantics(self):
        import api_streams
        for dataset in ('stats2', 'stats'):
            data = self.api('monthly', dataset=dataset, isrc='SE6QE2204745')
            self.assertTrue(data['milestones'])
            self.assertEqual(set(data['milestones'][0]), {'day', 'milestone', 'play_count'})
            detail = api_streams.track(Context(self.c, {'dataset': dataset}, self.service.bounds), 'SE6QE2204745', self.service.scopes)
            expected = sorted((str(m['created_at'].date()), m['milestone'], m['play_count']) for m in detail['milestones'])
            self.assertEqual(sorted((str(m['day']), m['milestone'], m['play_count']) for m in data['milestones']), expected)
            days = [str(m['day']) for m in data['milestones']]
            self.assertEqual(days, sorted(days))
        missing = self.c.execute("select isrc from isrc_identity where isrc not in (select isrc from isrc_day where dataset='stats') limit 1").fetchone()
        if missing: self.assertEqual(self.api('monthly', dataset='stats', isrc=missing[0])['milestones'], [])

    def test_monthly_sql_identity_and_partial_flags(self):
        for dataset in ('stats2', 'stats'):
            data = self.api('monthly', dataset=dataset, isrc='SE6QE2204745')
            months = data['rows']
            self.assertTrue(months[0]['partial_first_month']); self.assertTrue(months[-1]['partial_last_month'])
            for r in months:
                for side in ('from', 'to'):
                    expected = self.direct(dataset, data['track']['isrc'], r[side]['requested'])
                    self.assertEqual((r[side]['used_day'], r[side]['streams']), expected)
                self.assertEqual(r['streams_in_month'], r['to']['streams'] - r['from']['streams'])
            self.assertEqual(sum(r['streams_in_month'] for r in months), data['daily'][-1]['streams'] - data['daily'][0]['streams'])
            clean = [r for r in months if not any((r['from']['substituted'], r['to']['substituted'], r['partial_first_month'], r['partial_last_month']))]
            self.assertTrue(clean)
            # Contiguous runs telescope using the previous month-end baseline.
            run = [clean[0]]
            for r in clean[1:]:
                if r['from']['requested'] == run[-1]['to']['requested']: run.append(r)
                else: break
            self.assertEqual(sum(r['streams_in_month'] for r in run), run[-1]['to']['streams'] - run[0]['from']['streams'])

    def test_daily_and_monthly_csv(self):
        daily = self.api('monthly', isrc='SE6QE2204745')['daily']
        expected = rows(self.c, "select day,streams,observation_count observations,mode_confidence confidence from isrc_day where dataset='stats2' and isrc='SE6QE2204745' order by day")
        self.assertEqual([{k: r[k] for k in expected[0]} for r in daily], expected)
        for view in ('lookup_daily', 'lookup_monthly'):
            sql, p = self.service.export(self.c, {'view': view, 'isrc': 'SE6QE2204745'})
            csv = b''.join(csv_chunks(self.c, sql, p)).decode('utf-8-sig')
            self.assertIn('streams', csv); self.assertIn('2025-03', csv)

    # ---- round 3: availability days, source switches, artist report, search ----
    def test_days_endpoint_matches_isrc_day_rows(self):
        for dataset in ('stats2', 'stats'):
            data = self.api('days', dataset=dataset, isrc='SE6QE2204745')
            expected = {r[0] for r in self.c.execute("select day from isrc_day where dataset=? and isrc='SE6QE2204745' and streams is not null", [dataset]).fetchall()}
            covered = set()
            for first, last in data['ranges']:
                self.assertLessEqual(first, last)
                covered.update(first + dt.timedelta(days=i) for i in range((last - first).days + 1))
            self.assertEqual(covered, expected)
            # runs are maximal: consecutive runs are separated by at least one missing day
            for (_, a_last), (b_first, _) in zip(data['ranges'], data['ranges'][1:]):
                self.assertGreater((b_first - a_last).days, 1)
            self.assertEqual((data['first_day'], data['last_day']), (min(expected), max(expected)))
        # the known gap around 10..16 March 2025 is absent from the ranges
        data = self.api('days', isrc='SE6QE2204745')
        gap = [d for d in (dt.date(2025, 3, 10) + dt.timedelta(days=i) for i in range(7))
               if not any(a <= d <= b for a, b in data['ranges'])]
        self.assertTrue(gap)
        with self.assertRaises(APIError): self.api('days', isrc='NOPE')

    def test_dreams_source_switch(self):
        r = self.api('between', isrc='SE6QE2204745', **{'from': '2025-07-01', 'to': '2025-07-31'})
        self.assertEqual(len(r['source_switches']), 1)
        switch = r['source_switches'][0]
        self.assertEqual(str(switch['day']), '2025-07-17')
        before, after = (self.c.execute("select streams,selected_spotify_track_id from isrc_day where dataset='stats2' and isrc='SE6QE2204745' and day=?", [d]).fetchone()
                         for d in ('2025-07-16', '2025-07-17'))
        self.assertEqual((switch['from_id'], switch['to_id']), (before[1], after[1]))
        self.assertNotEqual(switch['from_id'], switch['to_id'])
        self.assertEqual(switch['jump'], after[0] - before[0])
        self.assertGreater(switch['jump'], 300000)
        self.assertGreater(r['difference'], switch['jump'])  # the difference includes the jump; numbers unchanged
        # excluded when the used days do not span the switch (window is (from used day, to used day])
        quiet = self.api('between', isrc='SE6QE2204745', **{'from': '2025-07-17', 'to': '2025-07-31'})
        self.assertEqual(quiet['source_switches'], [])
        monthly = self.api('monthly', isrc='SE6QE2204745')
        flagged = [m for m in monthly['rows'] if m['source_switches']]
        self.assertEqual([str(m['month']) for m in flagged], ['2025-07-01'])
        self.assertIn(switch, monthly['source_switches'])
        flags = {str(d['day']): d['flags'] for d in monthly['daily']}
        self.assertIn('source_switch', flags['2025-07-17'])
        self.assertNotIn('source_switch', flags['2025-07-16'])

    def test_source_switches_match_sql_for_many_tracks(self):
        for dataset in ('stats2', 'stats'):
            switches = {}
            sql = """select isrc,day,streams-ps from (select isrc,day,streams,selected_spotify_track_id sid,
                lag(selected_spotify_track_id) over w psid,lag(streams) over w ps from isrc_day where dataset=? and streams is not null
                window w as (partition by isrc order by day)) where psid is not null and sid<>psid order by isrc,day"""
            for isrc, day, jump in self.c.execute(sql, [dataset]).fetchall():
                switches.setdefault(isrc, []).append((day, jump))
            self.assertTrue(switches)
            for isrc in list(switches)[:25]:
                r = self.api('between', dataset=dataset, isrc=isrc, **{'from': '2010-01-01', 'to': '2040-01-01'})
                self.assertEqual([(s['day'], s['jump']) for s in r['source_switches']], switches[isrc])

    def test_artist_report_rows_equal_between_and_total_is_their_sum(self):
        ranges = [{'from': '2025-07-01', 'to': '2025-07-31'},
                  {'from': '2025-03-10', 'to': '2025-03-16'},  # gap days
                  {'from': '2019-01-01', 'to': '2019-12-31'},  # before tracking: every row empty
                  {'from': '2019-01-01', 'to': '2025-03-31'}]  # starts before tracking
        for dataset in ('stats2', 'stats'):
            artists = self.api('artists', dataset=dataset)['rows']
            names = ['Joongle'] + [a['name'] for a in artists[:: max(1, len(artists) // 6)]][:6]
            for name in names:
                for rg in ranges:
                    report = self.api('artist-report', dataset=dataset, artist=name, **rg)
                    members = self.api('tracks', dataset=dataset, artist=name)['rows']
                    self.assertEqual({r['track']['isrc'] for r in report['rows']}, {t['isrc'] for t in members})
                    total = 0
                    for row in report['rows']:
                        one = self.api('between', dataset=dataset, isrc=row['track']['isrc'], **rg)
                        stripped = {k: v for k, v in row.items() if k != 'track'}
                        self.assertEqual(stripped, {k: v for k, v in one.items() if k != 'track'})
                        self.assertEqual(row['track']['song_name'], one['track']['song_name'])
                        total += row['difference'] or 0
                    self.assertEqual(report['total'], total if report['counted_tracks'] else None)
                    self.assertEqual(report['counted_tracks'] + report['excluded_tracks'], len(members))
                    self.assertEqual(report['counted_tracks'], sum(r['difference'] is not None for r in report['rows']))
                    if rg['to'] < '2020': self.assertEqual(report['counted_tracks'], 0)

    def test_artist_report_validation_and_csv(self):
        with self.assertRaises(APIError): self.api('artist-report', artist='Joongle', **{'from': '2025-07-31', 'to': '2025-07-01'})
        with self.assertRaises(APIError): self.api('artist-report', **{'from': '2025-07-01', 'to': '2025-07-31'})
        self.assertEqual(self.api('artist-report', artist='Nobody At All', **{'from': '2025-07-01', 'to': '2025-07-31'})['rows'], [])
        p = {'view': 'artist_report', 'artist': 'Joongle', 'from': '2025-07-01', 'to': '2025-07-31'}
        sql, params = self.service.export(self.c, p)
        text = b''.join(csv_chunks(self.c, sql, params)).decode('utf-8-sig')
        lines = text.strip().splitlines()
        report = self.api('artist-report', **{k: v for k, v in p.items() if k != 'view'})
        self.assertEqual(len(lines) - 1, len(report['rows']))
        self.assertIn('Dreams', text); self.assertIn('source_switch_jump', lines[0])

    def test_search_finds_title_credit_isrc_and_spotify_id(self):
        found = self.api('search', q='dreams')
        self.assertTrue(any(t['isrc'] == 'SE6QE2204745' for t in found['tracks']))
        self.assertTrue(all('art' in t for t in found['tracks']))
        self.assertTrue(any(t['isrc'] == 'SE6QE2204745' for t in self.api('search', q='se6qe2204745')['tracks']))
        self.assertTrue(any(t['isrc'] == 'SE6QE2204745' for t in self.api('search', q='5p3RtNFDn8DjwdNXd6Flph')['tracks']))
        self.assertTrue(any(a['name'] == 'Nøway' for a in self.api('search', q='NOWAY')['artists']))
        self.assertEqual(self.api('search', q='  '), {'tracks': [], 'artists': []})
        prefix = self.api('search', q='dre')['tracks']
        self.assertTrue(prefix[0]['song_name'].lower().startswith('dre'))


if __name__ == '__main__': unittest.main()
