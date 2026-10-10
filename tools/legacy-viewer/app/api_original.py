"""Thin read-only HTTP adapters for the immutable, PostgreSQL-proven registry."""
from collections import OrderedDict
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import threading
import time

from api_common import APIError, csv_chunks, date, integer, order, rows
from grafana_compat import default_values, frames_to_jsonable, parse_custom_options, resolve_variable_options, run_panel

STARRED = {'stats2.spotify-dash', 'stats2.tax-v2', 'pf.playlist-followers'}
PANEL_KEYS = ('id', 'panel_id', 'title', 'type', 'gridPos', 'collapsed', 'status', 'status_reason',
              'fieldConfig', 'options', 'quirks', 'row', 'playlist_ids')


def utc(value):
    try:
        value = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)
    except (ValueError, TypeError):
        raise APIError('Time must be an ISO date or UTC timestamp') from None


def relative(value, anchor):
    if value == 'now': return anchor
    match = re.fullmatch(r'now-(\d+)([smhdwMy])', value)
    if not match: return utc(value)
    n, unit = int(match[1]), match[2]
    if unit in ('M', 'y'):
        import calendar
        month = anchor.year * 12 + anchor.month - 1 - n * (12 if unit == 'y' else 1)
        year, month = divmod(month, 12)
        return anchor.replace(year=year, month=month + 1, day=min(anchor.day, calendar.monthrange(year, month + 1)[1]))
    return anchor - dt.timedelta(seconds=n * {'s': 1, 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800}[unit])


def variables(p, defs):
    try: supplied = json.loads(p.get('vars') or '{}')
    except (ValueError, TypeError): raise APIError('vars must be a JSON object') from None
    if not isinstance(supplied, dict): raise APIError('vars must be a JSON object')
    if set(supplied) - set(defs): raise APIError('Unknown dashboard variable')
    for value in supplied.values():
        if not (isinstance(value, str) or isinstance(value, list) and all(isinstance(x, str) for x in value)):
            raise APIError('Variable values must be strings or lists of strings')
    return {**default_values(defs), **supplied}


class Original:
    def __init__(self, registry_path=None):
        root = Path(__file__).resolve().parent
        self.registry = json.loads((Path(registry_path) if registry_path else root/'grafana_registry.json').read_text(encoding='utf-8'))
        self.validation = json.loads((root/'panel_validation_summary.json').read_text(encoding='utf-8'))
        self.dashboards = {d['key']: d for d in self.registry['dashboards']}
        self.panels = {p['id']: p for p in self.registry['panels']}
        self.cache = OrderedDict()
        self.lock = threading.RLock()
        # Bound concurrent expensive raw-window queries (memory) without serializing the whole
        # dashboard: one slow diagnostic panel must not block every other panel.
        self.query_lock = threading.BoundedSemaphore(3)
        self.hits = 0

    def dashboard(self, key):
        if key not in self.dashboards: raise APIError('Dashboard not found', 404)
        return self.dashboards[key]

    def entry(self, p):
        entry = self.panels.get(p.get('id'))
        if not entry: raise APIError('Panel not found', 404)
        instance = None
        if entry.get('instances'):
            if not p.get('instance'): raise APIError('instance panel_id is required for this template')
            instance = next((i for i in entry['instances'] if str(i['panel_id']) == p['instance']), None)
            if instance is None: raise APIError('Panel instance not found', 404)
        elif p.get('instance'): raise APIError('This panel has no instances')
        return entry, instance

    def time_range(self, dashboard, p):
        anchor = utc(self.registry['datasets'][dashboard['dataset']]['anchor'])
        start = relative(p.get('from') or dashboard['time']['from'], anchor)
        end = relative(p.get('to') or dashboard['time']['to'], anchor)
        if start > end: raise APIError('from must be on or before to')
        return start, end

    def list_dashboards(self):
        result = []
        for d in self.dashboards.values():
            defs = {}
            for name, v in d['variables'].items():
                defs[name] = {k: v[k] for k in ('name', 'label', 'type', 'multi', 'includeAll', 'hide', 'current', 'depends_on', 'allValue') if k in v}
                defs[name]['options'] = parse_custom_options(v.get('query', '')) if v['type'] == 'custom' else []
            panels = []
            for entry in self.panels.values():
                if entry['dashboard_key'] != d['key'] or entry['type'] == 'row': continue
                base = {k: entry[k] for k in PANEL_KEYS if k in entry}
                if entry.get('instances'):
                    for instance in entry['instances']:
                        variants = entry.get('render_variants') or []
                        variant = variants[instance.get('render_variant', 0)] if variants else {}
                        panels.append({**base, **{k: instance[k] for k in ('panel_id', 'title', 'row', 'gridPos', 'playlist_ids')},
                                       'instance': str(instance['panel_id']), **variant})
                else: panels.append(base)
            row_defs = [{**row, 'panels': [p for p in panels if p.get('row') == row['title']]} for row in d['rows']]
            ungrouped = [p for p in panels if p.get('row') is None]
            if ungrouped: row_defs.insert(0, {'id': 'ungrouped', 'title': 'Panels', 'collapsed': False, 'panels': ungrouped})
            result.append({**{k: d[k] for k in ('key', 'title', 'server', 'version', 'grafana_version', 'dataset', 'time', 'identical_panel_ids')},
                           'starred': d['key'] in STARRED, 'variables': defs, 'rows': row_defs,
                           'anchor': self.registry['datasets'][d['dataset']]['anchor'],
                           'default_time_range': dict(zip(('from', 'to'), [x.isoformat() for x in self.time_range(d, {})]))})
        return {'dashboards': result}

    def options(self, con, p):
        d = self.dashboard(p.get('dashboard'))
        v = d['variables'].get(p.get('name'))
        if not v: raise APIError('Variable not found', 404)
        if v.get('hide') == 2 and v.get('type') == 'query':
            # Hidden in Grafana and unused by any panel query; resolving it would scan every raw row.
            return {'options': [], 'includeAll': bool(v.get('includeAll')), 'multi': bool(v.get('multi')), 'hidden': True}
        values = variables(p, d['variables'])
        options = resolve_variable_options(con, v, self.registry['datasets'][d['dataset']], values, d['variables'])
        seen, unique = set(), []
        for o in options:  # Grafana de-duplicates query-variable options
            k = json.dumps(o, sort_keys=True, default=str)
            if k not in seen: seen.add(k); unique.append(o)
        return {'options': unique, 'includeAll': bool(v.get('includeAll')), 'multi': bool(v.get('multi'))}

    def panel(self, con, p, uncapped=False):
        entry, instance = self.entry(p)
        d = self.dashboard(entry['dashboard_key'])
        values = variables(p, d['variables'])
        if instance: values.update(__account=instance['account_name'], __playlist=instance['playlist_name'])
        time_range = self.time_range(d, p)
        key = (entry['id'], p.get('instance'), json.dumps(values, sort_keys=True), *(x.isoformat() for x in time_range))
        with self.lock:
            if not uncapped and key in self.cache:
                self.hits += 1
                self.cache.move_to_end(key)
                return self.cache[key]
        with self.query_lock:
            with self.lock:
                if not uncapped and key in self.cache:
                    self.hits += 1
                    self.cache.move_to_end(key)
                    return self.cache[key]
            start = time.perf_counter()
            frames = [] if entry['status'] != 'implemented' else run_panel(con, entry, values, self.registry['datasets'][d['dataset']], time_range=time_range)
            truncated = any(len(f['rows']) > 50_000 for f in frames)
            if not uncapped: frames = [{**f, 'rows': f['rows'][:50_000]} for f in frames]
            result = {'frames': frames_to_jsonable(frames), 'truncated': truncated,
                      'ms': round((time.perf_counter() - start) * 1000, 2), 'sql_targets': [t['refId'] for t in entry['targets'] if not t.get('hide') and not t.get('excluded')],
                      'status': entry['status'], 'quirks': entry['quirks'], 'validation': self.validation[entry['id']],
                      'time_range': dict(zip(('from', 'to'), [x.isoformat() for x in time_range]))}
            if not uncapped:
                with self.lock:
                    self.cache[key] = result
                    while len(self.cache) > 200: self.cache.popitem(last=False)
            return result

    def sql(self, p):
        entry = self.panels.get(p.get('id'))
        if not entry: raise APIError('Panel not found', 404)
        return {'targets': [{k: t.get(k) for k in ('refId', 'original_sql', 'duckdb_sql', 'translation_rules', 'manual_translation', 'nondeterminism', 'hide', 'excluded')} for t in entry['targets']],
                'quirks': entry['quirks'], 'validation': self.validation[entry['id']], 'status_reason': entry.get('status_reason')}

    def raw_query(self, p, followers=False):
        dataset = p.get('dataset', 'stats2')
        if not followers and dataset not in ('stats2', 'stats'): raise APIError('Invalid dataset')
        anchor = date(self.registry['datasets']['pf' if followers else dataset]['anchor'][:10])
        start, end = date(p.get('from') or anchor - dt.timedelta(days=6)), date(p.get('to') or anchor)
        if start > end: raise APIError('from must be on or before to')
        if (end - start).days > 366: raise APIError('Raw browsing requires a range of at most 367 archive days')
        table, stamp = ('pf_followers', 'timestamp') if followers else ('src_tracks', 'created_at')
        where, params = [f'{stamp}>=? and {stamp}<?'], [start, end + dt.timedelta(days=1)]
        if not followers and dataset == 'stats': where.append('in_stats_dump')
        for key, column in [('playlist', 'playlist_id'), ('account', 'account_name')] if followers else [('playlist', 'playlist_id'), ('spotify_id', 'spotify_track_id')]:
            if p.get(key): where.append(column+'=?'); params.append(p[key])
        if p.get('q'):
            fields = "coalesce(playlist_name,'') || ' ' || coalesce(account_name,'')" if followers else "coalesce(song_name,'') || ' ' || coalesce(artist,'')"
            where.append('contains(lower('+fields+'), lower(?))'); params.append(p['q'])
        query = 'select * from main.'+table+' where '+' and '.join(where)
        allowed = ('timestamp', 'followers', 'playlist_name', 'account_name') if followers else ('created_at', 'play_count', 'song_name', 'artist', 'id')
        sort = order(p, allowed, stamp)
        tie = ',playlist_id,playlist_name,account_name,user_id,followers' if followers else ',id'
        return query, params, sort + tie, {'from': start.isoformat(), 'to': end.isoformat()}

    def raw(self, con, p, followers=False):
        query, params, sort, bounds = self.raw_query(p, followers)
        total = con.execute('select count(*) from ('+query+') r', params).fetchone()[0]
        limit, offset = integer(p, 'limit', 100, 1, 1000), integer(p, 'offset', 0, 0, 34_500_000)
        return {'rows': rows(con, query+' order by '+sort+' limit ? offset ?', [*params, limit, offset]),
                'total': total, 'limit': limit, 'offset': offset, 'range': bounds,
                'note': 'UTC date filters prune the archive scan. Default: last 7 archive days; maximum: 367 days.'}

    def export_chunks(self, con, p):
        if p['view'] != 'original_panel':
            query, params, sort, _ = self.raw_query(p, p['view'] == 'raw_follower_readings')
            return csv_chunks(con, query+' order by '+sort, params)
        # Transformations must run through compat. Stream serialization of the complete frame,
        # independent of the capped browser response (compat materializes SQL frames internally).
        frames = self.panel(con, p, uncapped=True)['frames']
        frame = next((f for f in frames if f['refId'] == p['ref']), None) if p.get('ref') else next(iter(frames), None)
        if p.get('ref') and frame is None: raise APIError('Frame ref not found', 404)
        return frame_csv(frame)


def frame_csv(frame):
    yield b'\xef\xbb\xbf'
    if not frame: return
    buf = io.StringIO(newline='')
    writer = csv.writer(buf)
    writer.writerow([c['name'] for c in frame['columns']])
    yield buf.getvalue().encode('utf-8')
    for start in range(0, len(frame['rows']), 256):
        buf.seek(0); buf.truncate(0)
        writer.writerows(frame['rows'][start:start + 256])
        yield buf.getvalue().encode('utf-8')
