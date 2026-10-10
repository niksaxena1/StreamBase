"""Exhaustive API sweep against a running viewer: every endpoint x datasets x grains x ranges x scopes,
every Original-dashboard panel (with default variables and every stamped instance), and every export.
Usage: python sweep_api.py http://127.0.0.1:8770  -> prints failures and a summary; exit 1 on any failure."""
import json
import datetime as dt
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8770'
failures, timings, count = [], [], 0


def get(path, params=None, raw=False):
    global count
    count += 1
    url = BASE + path + ('?' + urllib.parse.urlencode(params, doseq=True) if params else '')
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            body = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        body, status = e.read(), e.code
    except Exception as e:  # noqa: BLE001
        failures.append((url, 'EXC', repr(e)[:200]))
        return None
    timings.append((time.perf_counter() - t, url))
    if status != 200:
        failures.append((url, status, body[:300].decode('utf-8', 'replace')))
        return None
    if raw:
        return body
    try:
        data = json.loads(body)
    except ValueError as e:
        failures.append((url, 'BADJSON', str(e)[:200]))
        return None
    bad = find_bad(data)
    if bad:
        failures.append((url, 'BADVALUE', bad))
    return data


def find_bad(o, path='$'):
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return path
    if isinstance(o, str) and o in ('NaN', 'undefined') and not path.endswith(('name', 'title', 'song_name', 'artist')):
        return path + '=' + o
    if isinstance(o, dict):
        for k, v in o.items():
            r = find_bad(v, path + '.' + str(k))
            if r:
                return r
    if isinstance(o, list):
        for i, v in enumerate(o[:2000]):
            r = find_bad(v, f'{path}[{i}]')
            if r:
                return r
    return None


meta = get('/api/meta')
datasets = [d['key'] for d in meta['datasets']]
scopes = [s['key'] if isinstance(s, dict) else s for s in meta['scopes']]
bounds = {d['key']: (d['first_day'], d['last_day']) for d in meta['datasets']}
fb = (meta['followers']['first_day'], meta['followers']['last_day'])


def ranges(first, last):
    return [{}, {'from': first, 'to': last}, {'from': last, 'to': last}, {'from': '2024-01-01', 'to': '2024-03-31'},
            {'from': '2025-01-03', 'to': '2025-01-07'},  # inside a collection gap
            {'from': '2019-01-01', 'to': '2019-12-31'}]  # entirely outside the archive


# Lookup: every member track of 30 artists in both datasets, plus 50 distinct
# histories per dataset with exact, pre-tracking, gap, reset and zero-day ranges.
lookup_warm = []
for ds in datasets:
    artists = get('/api/lookup/artists', {'dataset': ds})['rows']
    get('/api/lookup/artists', {'dataset': ds, 'q': 'NOWAY'})
    selected = {}
    for a in artists[:30]:
        members = get('/api/lookup/tracks', {'dataset': ds, 'artist': a['name']})['rows']
        if len(members) != a['track_count'] or sum(t['latest_streams'] for t in members) != a['latest_total']:
            failures.append((a['name'], 'LOOKUP_MEMBERSHIP', ds))
        selected.update((t['isrc'], t) for t in members)
    # Artist range report: 30 artists x 3 ranges (normal, collection gap, before tracking);
    # every row must equal /between for its ISRC and the total must be the sum of the rows.
    first_day, last_day = bounds[ds]
    for a in artists[:30]:
        for n, rg in enumerate(({'from': last_day[:7] + '-01', 'to': last_day},
                                {'from': '2025-03-10', 'to': '2025-03-16'},
                                {'from': '2019-01-01', 'to': '2019-06-30'})):
            report = get('/api/lookup/artist-report', {'dataset': ds, 'artist': a['name'], **rg})
            if report is None: continue
            if n: lookup_warm.append(timings[-1])  # the first range pays the one-off bulk history load
            if len(report['rows']) != a['track_count']: failures.append((a['name'], 'REPORT_ROWS', rg))
            if sum(r['difference'] or 0 for r in report['rows']) != (report['total'] or 0): failures.append((a['name'], 'REPORT_TOTAL', rg))
            for row in report['rows'][:3]:
                one = get('/api/lookup/between', {'dataset': ds, 'isrc': row['track']['isrc'], **rg})
                if one and {k: v for k, v in one.items() if k != 'track'} != {k: v for k, v in row.items() if k != 'track'}:
                    failures.append((row['track']['isrc'], 'REPORT_ROW_MISMATCH', rg))
        get('/api/export', {'view': 'artist_report', 'dataset': ds, 'artist': a['name'], 'from': '2025-03-10', 'to': '2025-03-16'}, raw=True)
    for q in ('dre', 'joongle', 'SE6QE2204745', '5p3RtNFDn8DjwdNXd6Flph', 'nøway', 'x'):
        get('/api/lookup/search', {'dataset': ds, 'q': q})
        lookup_warm.append(timings[-1])
    candidates = get('/api/tracks', {'dataset': ds, 'limit': 100})['rows']
    selected.update((t['isrc'], t) for t in candidates)
    for t in list(selected.values())[:50]:
        prm = {'dataset': ds, 'isrc': t['isrc']}
        monthly = get('/api/lookup/monthly', prm)
        if monthly is None: continue
        daily = monthly['daily']
        if not daily: continue
        span = [{'from': daily[0]['day'], 'to': daily[-1]['day']},
                {'from': str(dt.date.fromisoformat(daily[0]['day']) - dt.timedelta(days=30)), 'to': daily[-1]['day']},
                {'from': daily[-1]['day'], 'to': daily[-1]['day']},
                {'from': '2025-03-11', 'to': '2025-03-31'},
                {'from': '2019-01-01', 'to': '2019-01-31'}]
        for i, r in enumerate(daily[1:], 1):
            previous = dt.date.fromisoformat(daily[i-1]['day'])
            if (dt.date.fromisoformat(r['day']) - previous).days > 1:
                span.append({'from': str(previous + dt.timedelta(days=1)), 'to': r['day']})
                break
        for i, r in enumerate(daily[1:], 1):
            if r['is_reset']:
                span.append({'from': daily[i-1]['day'], 'to': r['day']})
                break
        days_data = get('/api/lookup/days', prm)
        if days_data is not None:
            counted = sum((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days + 1 for a, b in days_data['ranges'])
            if counted != len(daily): failures.append((t['isrc'], 'LOOKUP_DAYS_COUNT', (counted, len(daily))))
            lookup_warm.append(timings[-1])
        for rg in span:
            value = get('/api/lookup/between', {**prm, **rg})
            if value and not value['empty']:
                if value['difference'] != value['to']['streams'] - value['from']['streams']:
                    failures.append((t['isrc'], 'LOOKUP_DIFFERENCE', rg))
        if sum(r['streams_in_month'] for r in monthly['rows']) != daily[-1]['streams'] - daily[0]['streams']:
            failures.append((t['isrc'], 'LOOKUP_MONTHLY_IDENTITY', ds))
        get('/api/lookup/monthly', prm)
        lookup_warm.append(timings[-1])
        get('/api/lookup/between', {**prm, **span[0]})
        lookup_warm.append(timings[-1])
    for endpoint, prm in [('artists', {'dataset': ds}), ('tracks', {'dataset': ds, 'artist': artists[0]['name']})]:
        get('/api/lookup/' + endpoint, prm)
        lookup_warm.append(timings[-1])
    for view in ('lookup_monthly', 'lookup_daily'):
        get('/api/export', {'view': view, 'dataset': ds, 'isrc': 'SE6QE2204745'}, raw=True)
    before = len(failures)
    get('/api/lookup/between', {'dataset': ds, 'isrc': 'SE6QE2204745', 'from': '2025-03-31', 'to': '2025-03-01'})
    if len(failures) == before + 1 and failures[-1][1] == 400: failures.pop()
    else: failures.append(('lookup reversed range', 'EXPECTED400', ds))

slowest_lookup = max(lookup_warm)
print(f'lookup warm slowest: {slowest_lookup[0]*1000:.1f}ms {slowest_lookup[1]}', flush=True)
if slowest_lookup[0] >= .3: failures.append((slowest_lookup[1], 'LOOKUP_LATENCY', slowest_lookup[0]))


for ds in datasets:
    first, last = bounds[ds]
    for rg in ranges(first, last):
        for grain in ('day', 'week', 'month'):
            base = {'dataset': ds, 'grain': grain, **rg}
            for sc in scopes:
                get('/api/overview', {**base, 'scope': sc})
            get('/api/explorer/overview', base)
        b = {'dataset': ds, **rg}
        tr = get('/api/tracks', {**b, 'limit': 5})
        get('/api/explorer/tracks', {**b, 'limit': 5})
        for q in ('noway', "o'", 'Never Giving Up', 'ø', '%', '"', 'zzzz-no-match'):
            get('/api/tracks', {**b, 'q': q, 'limit': 5})
        for sort in ('latest_streams', 'gained', 'avg_daily', 'first_day', 'resets', 'song_name'):
            for d in ('asc', 'desc'):
                get('/api/tracks', {**b, 'sort': sort, 'dir': d, 'limit': 3})
        get('/api/artists', {**b, 'limit': 5})
        get('/api/playlists', b)
        get('/api/explorer/playlists', b)
        get('/api/milestones', {**b, 'limit': 5})
        get('/api/milestones', {**b, 'limit': 5, 'exclude_lofi': 1})
        get('/api/quality', b)
    # detail pages for a spread of entities
    tracks = get('/api/tracks', {'dataset': ds, 'limit': 40, 'sort': 'latest_streams'})['rows']
    tracks += get('/api/tracks', {'dataset': ds, 'limit': 20, 'sort': 'first_day', 'dir': 'desc'})['rows']
    for t in tracks:
        for grain in ('day', 'month'):
            get('/api/track/' + urllib.parse.quote(t['isrc']), {'dataset': ds, 'grain': grain})
        get('/api/track/' + urllib.parse.quote(t['isrc']) + '/readings', {'dataset': ds, 'day': t['last_day']})
    for a in get('/api/artists', {'dataset': ds, 'limit': 25})['rows']:
        get('/api/artist/' + urllib.parse.quote(a['artist']), {'dataset': ds, 'grain': 'week'})
    for pl in meta['playlists']:
        pid = pl['playlist_id'] if isinstance(pl, dict) else pl
        get('/api/playlist/' + pid, {'dataset': ds, 'grain': 'day'})
        get('/api/explorer/playlist/' + pid, {'dataset': ds, 'grain': 'month'})
    get('/api/track/NOTANISRC', {'dataset': ds})  # expect a clean 404, recorded separately below

# followers
for rg in ranges(*fb):
    for grain in ('day', 'week', 'month'):
        get('/api/followers/overview', {'grain': grain, **rg})
    get('/api/followers/playlists', {'limit': 5, **rg})
    get('/api/followers/accounts', rg)
for g in meta['followers']['groups']:
    get('/api/followers/overview', {'group': g})
    get('/api/followers/playlists', {'group': g, 'limit': 5})
for p in get('/api/followers/playlists', {'limit': 60, 'sort': 'latest_followers'})['rows']:
    get('/api/followers/playlist/' + p['playlist_id'], {'grain': 'day'})
    get('/api/followers/playlist/' + p['playlist_id'], {'from': '2025-01-01', 'to': '2025-01-20'})

# raw browsers, archive
get('/api/raw/observations', {'dataset': 'stats2', 'limit': 50})
get('/api/raw/observations', {'dataset': 'stats', 'limit': 50, 'q': 'Joongle'})
get('/api/raw/follower-readings', {'limit': 50})
get('/api/archive')

# Original dashboards: every panel with its saved variables; every stamped instance
dash = get('/api/original/dashboards')
reg_panels = 0
for d in dash['dashboards']:
    for name, var in (d.get('variables') or {}).items():
        if var.get('type') == 'query':
            get('/api/original/variable-options', {'dashboard': d['key'], 'name': name})
    for row in d.get('rows') or []:
        for p in row.get('panels') or []:
            if p.get('type') in ('row', 'text') or p.get('status') == 'excluded':
                continue
            insts = [p.get('instance')] if p.get('instance') else (p.get('instances') or [None])
            for inst in insts:
                prm = {'id': p['id']}
                if inst:
                    prm['instance'] = inst['panel_id'] if isinstance(inst, dict) else inst
                reg_panels += 1
                get('/api/original/panel', prm)
            get('/api/original/panel-sql', {'id': p['id']})

# exports (streamed CSV)
for view, prm in [('tracks', {}), ('overview', {}), ('artists', {}), ('playlists', {}), ('milestones', {}),
                  ('followers_playlists', {}), ('followers_overview', {}), ('followers_accounts', {}),
                  ('quality_resets', {}), ('archive', {}), ('explorer_tracks', {}), ('explorer_overview', {}),
                  ('explorer_playlists', {}), ('track', {'isrc': tracks[0]['isrc']}),
                  ('track_records', {'isrc': tracks[0]['isrc']}), ('artist', {'name': 'Joongle'}),
                  ('playlist', {'id': '0OwqBeZIh0JNJcIVobdtOz'}), ('explorer_playlist', {'id': '0OwqBeZIh0JNJcIVobdtOz'}),
                  ('followers_playlist', {'id': get('/api/followers/playlists', {'limit': 1})['rows'][0]['playlist_id']}),
                  ('original_panel', {'id': 'stats2.spotify-dash.75'}), ('raw_observations', {'dataset': 'stats2'}),
                  ('raw_follower_readings', {})]:
    body = get('/api/export', {'view': view, **prm}, raw=True)
    if body is not None and len(body) < 10:
        failures.append((view, 'EMPTYCSV', body))

# reversed ranges must be rejected cleanly with 400
for ds in datasets:
    first, last = bounds[ds]
    n_before = len(failures)
    get('/api/overview', {'dataset': ds, 'from': last, 'to': first})
    if len(failures) == n_before + 1 and failures[-1][1] == 400:
        failures.pop()
    else:
        failures.append(('reversed range not rejected with 400', ds, ''))
expected_404 = [f for f in failures if 'NOTANISRC' in f[0] and f[1] == 404]
real = [f for f in failures if f not in expected_404]
json.dump(real, open('sweep_failures.json', 'w', encoding='utf-8'), indent=1, default=str)
timings.sort(reverse=True)
print(f'requests: {count}, original panel requests: {reg_panels}, failures: {len(real)}')
for f in real[:80]:
    print('FAIL', f)
print('slowest:')
for s, u in timings[:8]:
    print(f'  {s:6.2f}s {u[len(BASE):][:150]}')
sys.exit(1 if real else 0)
