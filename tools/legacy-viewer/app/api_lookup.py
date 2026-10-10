"""Track lookup: two UTC counter readings, never interpolated or zero-filled.

The archive is immutable. Small dataset summaries and a bounded history cache
avoid scanning the catalog for each keystroke; no tables or Explorer rules change.
"""
import bisect
import calendar
import datetime as dt
from collections import OrderedDict
import threading
import unicodedata

from api_common import APIError, date, one, rows


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.casefold())
                   if not unicodedata.combining(c)).replace('ø', 'o').replace('ł', 'l')


def required(p, key):
    if not p.get(key): raise APIError(key + ' is required')
    return p[key]


def reading(history, requested):
    """Exact day, otherwise previous row; before tracking use the first row."""
    if not history: return None
    days = [r['day'] for r in history]
    index = bisect.bisect_right(days, requested) - 1
    before = index < 0
    r = history[max(index, 0)]
    return {'requested': requested, 'used_day': r['day'], 'streams': r['streams'],
            'substituted': r['day'] != requested, 'before_tracking': before}


def interval(history, start, end):
    days = (end - start).days
    inside = [r for r in history if start < r['day'] <= end]
    return {'days': days, 'resets': [r['day'] for r in inside if r['is_reset']],
            'gap_days': max(0, days - len(inside))}


def source_switches(history, start, end):
    """Selected Spotify ID changes on rows inside (start, end]. jump = streams(day) - streams(previous row)."""
    result = []
    for previous, row in zip(history, history[1:]):
        if (start < row['day'] <= end and row.get('source_id') and previous.get('source_id')
                and row['source_id'] != previous['source_id']):
            result.append({'day': row['day'], 'from_id': previous['source_id'], 'to_id': row['source_id'],
                           'jump': row['streams'] - previous['streams']})
    return result


def compare(track, history, start, end):
    """The one From/To computation: used by /between and by every artist-report row."""
    left, right = reading(history, start), reading(history, end)
    # A range wholly outside tracking or wholly inside a gap is explicitly
    # empty. Resolved readings remain visible for explaining substitutions.
    empty = not any(start <= r['day'] <= end for r in history)
    result = {'track': track, 'from': left, 'to': right, 'empty': empty,
              'difference': None, 'days': 0, 'per_day': None, 'resets': [], 'gap_days': 0,
              'source_switches': []}
    if left and right:
        result.update(interval(history, left['used_day'], right['used_day']))
        result['source_switches'] = source_switches(history, left['used_day'], right['used_day'])
        if not empty:
            result['difference'] = right['streams'] - left['streams']
            result['per_day'] = result['difference'] / result['days'] if result['days'] else None
    return result


def day_ranges(history):
    ranges = []
    for r in history:
        if ranges and (r['day'] - ranges[-1][1]).days == 1: ranges[-1][1] = r['day']
        else: ranges.append([r['day'], r['day']])
    return ranges


def month_end(day):
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


class Lookup:
    art = None  # api_art.Art, injected by the service; None = no artwork

    def __init__(self):
        self._summaries = {}
        self._histories = OrderedDict()
        self._bulk = OrderedDict()
        self._search = {}
        self._lock = threading.RLock()

    def summaries(self, ctx):
        with self._lock:
            if ctx.dataset not in self._summaries:
                tracks = rows(ctx.con, '''select i.isrc,i.song_name,i.artist,
                  h.first_day,h.last_day,h.latest_streams from (
                  select isrc,min(day) first_day,max(day) last_day,arg_max(streams,day) latest_streams
                  from isrc_day where dataset=? and streams is not null group by isrc
                  ) h join isrc_identity i using(isrc)''', [ctx.dataset])
                # Track picker order: alphabetical by title, case/accent-insensitive (Grafana's
                # ORDER BY song_name ASC); ties keep a stable, deterministic order.
                tracks.sort(key=lambda t: (normalized(t['song_name']), t['song_name'], t['isrc']))
                by_artist = {}
                for track in tracks:
                    for artist in set(a.strip() for a in track['artist'].split(',') if a.strip()):
                        by_artist.setdefault(artist, []).append(track)
                artists = [{'name': name, 'track_count': len(members),
                            'latest_total': sum(t['latest_streams'] for t in members)}
                           for name, members in sorted(by_artist.items(), key=lambda item: (normalized(item[0]), item[0]))]
                self._summaries[ctx.dataset] = (by_artist, artists)
            return self._summaries[ctx.dataset]

    def search_index(self, ctx):
        """(folded searchable text, folded title, track) per track; Spotify IDs only live here."""
        self.summaries(ctx)
        with self._lock:
            if ctx.dataset not in self._search:
                by_isrc = {r[0]: r[1] or [] for r in ctx.con.execute(
                    'select isrc,spotify_track_ids from isrc_identity').fetchall()}
                tracks = {t['isrc']: t for members in self.summaries(ctx)[0].values() for t in members}
                self._search[ctx.dataset] = [
                    (normalized(' '.join([t['song_name'], t['artist'], t['isrc'], *by_isrc.get(t['isrc'], [])])),
                     normalized(t['song_name']), t) for t in sorted(tracks.values(), key=lambda t: (normalized(t['song_name']), t['isrc']))]
            return self._search[ctx.dataset]

    def search(self, ctx):
        """Quick-jump candidates: tracks (title, credit, ISRC, Spotify ID) and artists. The UI ranks them."""
        q = normalized(ctx.p.get('q', '').strip())
        if not q: return {'tracks': [], 'artists': []}
        matches = [(title.startswith(q), t) for text, title, t in self.search_index(ctx) if q in text]
        matches.sort(key=lambda m: not m[0])  # stable: prefix titles first, then alphabetical
        tracks = [t for _, t in matches[:300]]
        _, artists = self.summaries(ctx)
        found = [a for a in artists if q in normalized(a['name'])]
        found.sort(key=lambda a: not normalized(a['name']).startswith(q))
        art = self.art
        return {'tracks': art.with_tracks(tracks) if art else [{**t, 'art': None} for t in tracks],
                'artists': art.with_artists(found[:40], 'name') if art else [{**a, 'art': None} for a in found[:40]]}

    def artists(self, ctx):
        _, artists = self.summaries(ctx)
        q = normalized(ctx.p.get('q', '').strip())
        matched = [a for a in artists if q in normalized(a['name'])]
        return {'rows': self.art.with_artists(matched, 'name') if self.art else [{**a, 'art': None} for a in matched]}

    def tracks(self, ctx):
        by_artist, _ = self.summaries(ctx)
        members = by_artist.get(required(ctx.p, 'artist'), [])
        return {'rows': self.art.with_tracks(members) if self.art else [{**t, 'art': None} for t in members]}

    def decorated(self, track):
        """Identity plus artwork: `art` (cover URL or null) and per-credit artist photos."""
        if not self.art: return {**track, 'art': None, 'artists': self.credits_of(track)}
        return {**track, 'art': self.art.track(track['isrc']), 'artists': self.art.credits(track['artist'])}

    @staticmethod
    def credits_of(track):
        return [{'name': n.strip(), 'art': None} for n in track['artist'].split(',') if n.strip()]

    def history(self, ctx):
        key = (ctx.dataset, required(ctx.p, 'isrc'))
        with self._lock:
            if key not in self._histories:
                track = one(ctx.con, 'select isrc,song_name,artist from isrc_identity where isrc=?', [key[1]])
                if not track: raise APIError('Track not found', 404)
                history = rows(ctx.con, '''select day,streams,observation_count observations,
                  mode_confidence confidence,is_reset,ids_disagree,prev_day,delta,
                  selected_spotify_track_id source_id
                  from isrc_day where dataset=? and isrc=? and streams is not null order by day''', key)
                # Same matching as the Explorer track detail (api_streams.track): exact song_name +
                # artist variants seen for this ISRC; dataset clause as everywhere else.
                milestones = rows(ctx.con, '''select cast(m.created_at as date) as day,m.milestone,m.play_count
                  from src_milestones m where (?='stats2' or m.in_stats_dump) and exists(
                    select 1 from track_identity ti, unnest(ti.names_seen) n(v)
                    where ti.isrc=? and n.v.song_name=m.song_name and n.v.artist=m.artist)
                  order by m.created_at,m.play_count,m.id''', [ctx.dataset, key[1]])
                self._histories[key] = (track, history, milestones)
                if len(self._histories) > 128: self._histories.popitem(last=False)
            self._histories.move_to_end(key)
            return self._histories[key]

    def histories(self, ctx, isrcs):
        """Histories of many tracks in one query (artist report). Same rows as `history()`."""
        key = (ctx.dataset, tuple(isrcs))
        with self._lock:
            if key not in self._bulk:
                grouped = {isrc: [] for isrc in isrcs}
                for r in rows(ctx.con, '''select isrc,day,streams,observation_count observations,
                  mode_confidence confidence,is_reset,ids_disagree,prev_day,delta,
                  selected_spotify_track_id source_id
                  from isrc_day where dataset=? and list_contains(?::varchar[],isrc) and streams is not null
                  order by isrc,day''', [ctx.dataset, list(isrcs)]):
                    grouped[r.pop('isrc')].append(r)
                self._bulk[key] = grouped
                if len(self._bulk) > 6: self._bulk.popitem(last=False)
            self._bulk.move_to_end(key)
            return self._bulk[key]

    def between(self, ctx):
        start, end = date(required(ctx.p, 'from')), date(required(ctx.p, 'to'))
        if end < start: raise APIError('from must be on or before to')
        track, history, _ = self.history(ctx)
        return compare(track, history, start, end)

    def days(self, ctx):
        """Days that have a reading, as inclusive [first, last] runs of consecutive days."""
        track, history, _ = self.history(ctx)
        return {'isrc': track['isrc'], 'first_day': history[0]['day'] if history else None,
                'last_day': history[-1]['day'] if history else None, 'ranges': day_ranges(history)}

    def artist_report(self, ctx):
        """Every track credited to an artist, each row produced by the very same `compare()`
        that serves /api/lookup/between. Histories are bulk-loaded, but rows are identical."""
        start, end = date(required(ctx.p, 'from')), date(required(ctx.p, 'to'))
        if end < start: raise APIError('from must be on or before to')
        artist = required(ctx.p, 'artist')
        by_artist, _ = self.summaries(ctx)
        members = by_artist.get(artist, [])
        histories = self.histories(ctx, [t['isrc'] for t in members])
        result = []
        for member in members:
            track = {'isrc': member['isrc'], 'song_name': member['song_name'], 'artist': member['artist']}
            row = compare(track, histories.get(member['isrc'], []), start, end)
            result.append({**row, 'track': {**self.decorated(track), 'first_day': member['first_day'],
                                             'last_day': member['last_day']}})
        counted = [r for r in result if r['difference'] is not None]
        return {'artist': artist, 'from': start, 'to': end,
                'art': self.art.artist(artist) if self.art else None, 'rows': result,
                'total': sum(r['difference'] for r in counted) if counted else None,
                'counted_tracks': len(counted), 'excluded_tracks': len(result) - len(counted)}

    def monthly(self, ctx):
        track, history, milestones = self.history(ctx)
        if not history: return {'track': self.decorated(track), 'rows': [], 'daily': [], 'milestones': [], 'empty': True}
        first, last = history[0]['day'], history[-1]['day']
        month = first.replace(day=1)
        result = []
        while month <= last:
            end = month_end(month)
            partial_first = month == first.replace(day=1)
            partial_last = end > last
            left = reading(history, first if partial_first else month - dt.timedelta(days=1))
            right = reading(history, end)
            info = interval(history, left['used_day'], right['used_day'])
            info['source_switches'] = source_switches(history, left['used_day'], right['used_day'])
            result.append({'month': month, 'from': left, 'to': right,
                           'streams_in_month': right['streams'] - left['streams'],
                           'end_total': right['streams'], 'partial_first_month': partial_first,
                           'partial_last_month': partial_last, **info})
            month = end + dt.timedelta(days=1)
        switched = {s['day'] for s in source_switches(history, first - dt.timedelta(days=1), last)}
        daily = [{**r, 'flags': [flag for flag, value in (
            ('reset', r['is_reset']), ('linked_ids_disagree', r['ids_disagree']),
            ('source_switch', r['day'] in switched),
            ('gap_before', r['prev_day'] is not None and (r['day'] - r['prev_day']).days > 1)) if value]}
                 for r in history]
        return {'track': {**self.decorated(track), 'first_day': first, 'last_day': last,
                          'latest_streams': history[-1]['streams']},
                'rows': result, 'daily': daily, 'milestones': milestones, 'empty': False,
                'source_switches': source_switches(history, first - dt.timedelta(days=1), last)}

    def export(self, ctx, view):
        if view == 'artist_report':
            data = self.artist_report(ctx)
            flat = [{'isrc': r['track']['isrc'], 'song_name': r['track']['song_name'], 'artist_credit': r['track']['artist'],
                     'from_requested': r['from']['requested'] if r['from'] else None,
                     'from_used_day': r['from']['used_day'] if r['from'] else None,
                     'from_streams': r['from']['streams'] if r['from'] else None,
                     'from_substituted': r['from']['substituted'] if r['from'] else None,
                     'from_before_tracking': r['from']['before_tracking'] if r['from'] else None,
                     'to_requested': r['to']['requested'] if r['to'] else None,
                     'to_used_day': r['to']['used_day'] if r['to'] else None,
                     'to_streams': r['to']['streams'] if r['to'] else None,
                     'to_substituted': r['to']['substituted'] if r['to'] else None,
                     'to_before_tracking': r['to']['before_tracking'] if r['to'] else None,
                     'difference': r['difference'], 'days': r['days'], 'per_day': r['per_day'],
                     'empty': r['empty'], 'resets': r['resets'], 'gap_days': r['gap_days'],
                     'source_switches': len(r['source_switches']),
                     'source_switch_jump': sum(s['jump'] for s in r['source_switches'])} for r in data['rows']]
            schema = '''isrc varchar,song_name varchar,artist_credit varchar,from_requested date,from_used_day date,
              from_streams bigint,from_substituted boolean,from_before_tracking boolean,to_requested date,
              to_used_day date,to_streams bigint,to_substituted boolean,to_before_tracking boolean,
              difference bigint,days integer,per_day double,empty boolean,resets date[],gap_days integer,
              source_switches integer,source_switch_jump bigint'''
            return 'select r.* from unnest(?::struct(' + schema + ')[]) t(r) order by r.song_name,r.isrc', [flat]
        required(ctx.p, 'isrc')
        if view == 'lookup_daily':
            return '''select day,streams,observation_count observations,mode_confidence confidence,
              is_reset,ids_disagree,prev_day is not null and prev_day<>day-1 gap_before,
              concat_ws(';',case when is_reset then 'reset' end,
                case when ids_disagree then 'linked_ids_disagree' end,
                case when prev_day is not null and prev_day<>day-1 then 'gap_before' end) flags
              from isrc_day where dataset=? and isrc=? order by day''', [ctx.dataset, ctx.p['isrc']]
        data = self.monthly(ctx)
        flat = [{'month': r['month'], 'streams_in_month': r['streams_in_month'], 'end_total': r['end_total'],
                 'from_requested': r['from']['requested'], 'from_used_day': r['from']['used_day'],
                 'to_requested': r['to']['requested'], 'to_used_day': r['to']['used_day'],
                 'from_substituted': r['from']['substituted'], 'to_substituted': r['to']['substituted'],
                 'partial_first_month': r['partial_first_month'], 'partial_last_month': r['partial_last_month'],
                 'resets': r['resets'], 'gap_days': r['gap_days']} for r in data['rows']]
        schema = '''month date,streams_in_month bigint,end_total bigint,from_requested date,from_used_day date,
          to_requested date,to_used_day date,from_substituted boolean,to_substituted boolean,
          partial_first_month boolean,partial_last_month boolean,resets date[],gap_days integer'''
        return 'select r.* from unnest(?::struct(' + schema + ')[]) t(r) order by r.month', [flat]
