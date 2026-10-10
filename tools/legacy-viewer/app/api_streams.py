"""Explorer stream endpoints. ISRC counters and Grafana F2 stay separate."""
import datetime as dt
import json
from urllib.parse import unquote

from api_common import APIError, Context, bucket_sql, one, rows, search, with_calendar

CATALOG_METHOD = 'catalog: per-ISRC daily mode, MAX across linked Spotify ids'
PLAYLIST_METHOD = "playlist total = sum of member tracks' daily modes (Explorer). Grafana's hourly-total mode is reproduced exactly in Original dashboards."


def scopes(playlists):
    result = [{'key': 'all', 'label': 'All tracked tracks', 'playlist_ids': []},
              {'key': 'releases_extended', 'label': 'Releases + Extended', 'playlist_ids': ['0OwqBeZIh0JNJcIVobdtOz', '6Cbnl3B3t8mPcEXWskPjfw']}]
    for p in playlists:
        result.append({'key': p['playlist_id'], 'label': p['name'] or p['playlist_id'] + ' (name unknown)', 'playlist_ids': [p['playlist_id']]})
    persons = sorted({person for p in playlists for person in p['persons']})
    for person in persons:
        result.append({'key': 'person:' + person, 'label': 'Tax V2: ' + person, 'playlist_ids': [p['playlist_id'] for p in playlists if person in p['persons']]})
    return result


def scope_ids(ctx, available):
    value = ctx.p.get('playlist') or ctx.p.get('scope', 'all')
    if value == 'all': return None
    for scope in available:
        if value in (scope['key'], scope['label'], 'playlist:' + scope['key']): return scope['playlist_ids']
    raise APIError('Unknown playlist/scope')


def track_query(ctx, available, forced_isrc=None):
    # One derived-table scan, retaining the previous known counter even over gaps.
    sql = '''with history as (
        select isrc, min(day) first_day, max(day) last_day,
        arg_max(streams,day) latest_streams,
        arg_max(streams,day) filter(where day < ? and streams is not null) baseline,
        arg_min(streams,day) filter(where day >= ? and streams is not null) first_in_range,
        min(day) filter(where day >= ? and streams is not null) first_in_range_day,
        max(day) filter(where streams is not null) latest_streams_day,
        sum(observation_count) filter(where day >= ?) observations,
        count(*) filter(where day >= ? and ids_disagree) ids_disagree_days,
        count(*) filter(where day >= ? and is_reset) resets,
        count(*) filter(where day >= ?) range_days
        from isrc_day where dataset=? and day <= ? group by isrc
    ), summary as (
        select i.isrc,i.song_name,i.artist,i.spotify_track_ids,
        list_transform(i.playlists, pid -> coalesce((select name from playlists where playlist_id=pid),pid)) playlists,
        h.first_day,h.last_day,h.latest_streams,h.latest_streams_day,
        h.latest_streams-coalesce(h.baseline,h.first_in_range) gained,
        h.baseline is null and h.first_in_range is not null started_in_range,
        (h.latest_streams-coalesce(h.baseline,h.first_in_range))::double /
          greatest(date_diff('day', case when h.baseline is null then h.first_in_range_day else ?::date-interval 1 day end, h.latest_streams_day),1) avg_daily,
        h.observations,h.ids_disagree_days,h.resets
        from history h join isrc_identity i using(isrc) where h.range_days>0
    ) select * from summary s where true'''
    params = [ctx.start] * 7 + [ctx.dataset, ctx.end, ctx.start]
    # DuckDB does not allow correlated subqueries inside lambda: membership names
    # are resolved by a small reference aggregate instead.
    sql = sql.replace("list_transform(i.playlists, pid -> coalesce((select name from playlists where playlist_id=pid),pid)) playlists", "(select list(coalesce(p.name,p.playlist_id) order by p.playlist_id) from playlists p where list_contains(i.playlists,p.playlist_id)) playlists")
    if forced_isrc:
        sql += ' and s.isrc=?'; params.append(forced_isrc)
    if ctx.p.get('q'):
        sql += ' and ' + search("s.song_name || ' ' || s.artist || ' ' || s.isrc || ' ' || array_to_string(s.spotify_track_ids, ' ')")
        params.append(ctx.p['q'])
    if ctx.p.get('artist'):
        sql += " and list_contains(list_transform(string_split(s.artist,','), a -> trim(a)), ?)"
        params.append(ctx.p['artist'])
    ids = scope_ids(ctx, available)
    if ids is not None:
        sql += ''' and exists(select 1 from playlist_track_day pt join isrc_map m using(spotify_track_id)
                 where pt.dataset=? and pt.day between ? and ? and m.isrc=s.isrc and list_contains(?::varchar[],pt.playlist_id))'''
        params += [ctx.dataset, ctx.start, ctx.end, ids]
    return sql, params


TRACK_SORTS = {'isrc', 'song_name', 'artist', 'first_day', 'last_day', 'latest_streams', 'gained', 'avg_daily', 'observations', 'ids_disagree_days', 'resets'}


def tracks(ctx, available, export=False):
    sql, params = track_query(ctx, available)
    return ctx.page(sql, params, TRACK_SORTS, 'latest_streams', export)


def gained(ctx, daily_sql, params, counter):
    r = one(ctx.con, 'select arg_max(' + counter + ',day) latest, arg_max(' + counter + ',day) filter(where day<?) baseline, arg_min(' + counter + ',day) filter(where day>=?) first_in_range from (' + daily_sql + ') t where day<=?', [ctx.start, ctx.start, *params, ctx.end])
    start = r['baseline'] if r['baseline'] is not None else r['first_in_range']
    return {'gained': r['latest'] - start if r['latest'] is not None and start is not None else None, 'started_in_range': r['baseline'] is None and r['first_in_range'] is not None}


def playlist_daily(ctx, ids):
    # A group total is only meaningful when every member playlist that was being
    # collected at the time reported that day; Grafana summed whatever was present,
    # producing ±1B spikes. Partial days stay NULL here (Original mode keeps Grafana's sum).
    sql = '''select d.day, case when count(*)=any_value(a.expected) then sum(d.total_track_mode) end total,
      sum(d.total_track_mode) reported_total, count(*) playlists_reported, any_value(a.expected) playlists_expected,
      (select count(distinct spotify_track_id) from playlist_track_day pt where pt.dataset=? and pt.day=d.day and list_contains(?::varchar[],pt.playlist_id)) tracks
      from playlist_day d join (
        select c.day, count(*) expected from (select distinct day from playlist_day where dataset=?) c
        join (select playlist_id, min(day) f, max(day) l from playlist_day where dataset=? and list_contains(?::varchar[],playlist_id) group by 1) s
          on c.day between s.f and s.l group by c.day) a on a.day=d.day
      where d.dataset=? and list_contains(?::varchar[],d.playlist_id) and d.day<=? group by d.day'''
    return '''select *,total-lag(total) over(order by day) daily_change,
      case when lag(day) over(order by day)=day-1 then total-lag(total) over(order by day) end net
      from (select * from (''' + sql + ') x where total is not null) d', [ctx.dataset, ids, ctx.dataset, ctx.dataset, ids, ctx.dataset, ids, ctx.end]


def overview(ctx, available, export=False):
    ids = scope_ids(ctx, available)
    if ids is None:
        # Partial collection days (<90% of tracked ISRCs read) have no meaningful catalog total.
        daily = 'select day,streams_complete streams,daily_net net,tracks,resets,missing_prev,low_coverage,is_partial from catalog_day where dataset=? and day<=?'
        params = [ctx.dataset, ctx.end]
        dense, cal = with_calendar(daily, ctx, 'net')
        sql = bucket_sql(dense, ctx.grain, ('streams', 'tracks'), ('net', 'resets', 'missing_prev'), ('bool_or(low_coverage) low_coverage', 'bool_or(is_partial) is_partial'), 'net')
        if export: return sql, params + cal
        series = rows(ctx.con, sql, params + cal)
        kpis = one(ctx.con, '''select max(day) last_day,arg_max(streams_complete,day) filter(where streams_complete is not null) latest_streams,
          max(day) filter(where streams_complete is not null) latest_streams_day,
          avg(daily_net) avg_daily_net,sum(resets) resets,count(*) filter(where not is_partial)::double/?*100 coverage_pct,
          count(*) filter(where is_partial) partial_days
          from catalog_day where dataset=? and day between ? and ?''', [ctx.days, ctx.dataset, ctx.start, ctx.end])
        kpis['tracks'] = ctx.con.execute('select count(distinct isrc) from isrc_day where dataset=? and day between ? and ?', [ctx.dataset, ctx.start, ctx.end]).fetchone()[0]
        kpis['artists'] = ctx.con.execute('''with names as (
          select distinct trim(unnest(string_split(artist,','))) artist_name from (
            select distinct artist from src_tracks where created_at>=? and created_at<? and (?='stats2' or in_stats_dump)) observed)
          select count(distinct a.artist_name) from names n join src_artists a using(artist_name)''', [ctx.start, ctx.end+dt.timedelta(days=1), ctx.dataset]).fetchone()[0]
        # The catalog total jumps when a track enters tracking with a pre-existing
        # counter, so "gained" sums each ISRC's own growth instead.
        total_change = gained(ctx, daily, params, 'streams')
        track_sql, track_params = track_query(ctx, available)
        per_track = one(ctx.con, 'select sum(gained) gained, count(*) filter(where started_in_range) tracks_started_in_range from (' + track_sql + ') t', track_params)
        kpis.update({'gained': per_track['gained'], 'started_in_range': total_change['started_in_range'],
                     'tracks_started_in_range': per_track['tracks_started_in_range'], 'catalog_total_change': total_change['gained']})
        return {'method': CATALOG_METHOD, 'kpis': kpis, 'series': series, 'notes': ['Cumulative totals are blank on partial collection days (fewer than 90% of the ISRCs being tracked were read, e.g. 2025-07-05..09 with 9 of 2,418); coverage % counts only complete days.', 'gained = sum over ISRCs of each track\'s own growth (tracks first observed inside the range count from their first observed value); catalog_total_change = change of the tracked-catalog total, which also includes counters of tracks entering or leaving tracking.', 'artists counts distinct src_artists names present in exact comma-split raw readings in the selected dataset/range; spelling variants are retained.', 'MA7 uses non-null daily net in trailing 7 UTC dates, requires 4 values.']}
    daily, params = playlist_daily(ctx, ids)
    dense, cal = with_calendar(daily, ctx, 'daily_change')
    sql = bucket_sql(dense, ctx.grain, ('total', 'tracks'), ('daily_change', 'net'), ma_column='daily_change')
    # A week's/month's membership is the union of its observed Spotify IDs,
    # rather than the membership count on the last observed day.
    sql = '''with buckets as (''' + sql + '''), membership as (
      select cast(date_trunc(''' + "'" + ctx.grain + "'" + ''',day) as date) bucket,count(distinct spotify_track_id) tracks
      from playlist_track_day where dataset=? and list_contains(?::varchar[],playlist_id) and day between ? and ? group by 1)
      select b.* exclude(tracks),m.tracks from buckets b left join membership m using(bucket) order by bucket'''
    series_params=params+cal+[ctx.dataset,ids,ctx.start,ctx.end]
    if export: return sql, series_params
    series = rows(ctx.con, sql, series_params)
    kpis = one(ctx.con, 'select arg_max(total,day) latest_streams,max(day) last_day,avg(net) avg_daily_net,count(*)::double/?*100 coverage_pct from (' + daily + ') d where day between ? and ?', [ctx.days, *params, ctx.start, ctx.end])
    kpis.update(gained(ctx, daily, params, 'total'))
    return {'method': PLAYLIST_METHOD, 'kpis': kpis, 'series': series, 'notes': ['daily_change is total minus previous observed row exactly as Grafana LAG; it can span gaps.', 'net is NULL unless the previous observed row is the preceding UTC day.', 'Playlist group F2 totals can count the same track in multiple playlists.']}


def track_records(ctx, isrc):
    return 'select * from isrc_day where dataset=? and isrc=? and day between ? and ? order by day', [ctx.dataset, isrc, ctx.start, ctx.end]


def track_series(ctx, isrc):
    daily = 'select day,streams,delta net,observation_count observations,mode_confidence min_confidence,is_reset has_reset,prev_day is not null and prev_day<>day-1 gap_before from isrc_day where dataset=? and isrc=? and day<=?'
    params = [ctx.dataset, isrc, ctx.end]
    dense, cal = with_calendar(daily, ctx, 'net')
    sql = bucket_sql(dense, ctx.grain, ('streams',), ('net', 'observations'), ('min(min_confidence) min_confidence', 'bool_or(has_reset) has_reset', 'bool_or(gap_before) gap_before'), 'net')
    return sql, params + cal


def track(ctx, isrc, available):
    identity = one(ctx.con, 'select * from isrc_identity where isrc=?', [isrc])
    if not identity: raise APIError('Track not found', 404)
    identity['per_id'] = rows(ctx.con, 'select * from track_identity where isrc=? order by spotify_track_id', [isrc])
    sql, params = track_series(ctx, isrc)
    series = rows(ctx.con, sql, params)
    per_id = []
    for ti in identity['per_id']:
        daily = 'select day,streams,delta net,observation_count observations from track_day where dataset=? and spotify_track_id=? and day<=?'
        dense, cal = with_calendar(daily, ctx, 'net')
        query = bucket_sql(dense, ctx.grain, ('streams',), ('net','observations'), ma_column='net')
        per_id.append({'spotify_track_id': ti['spotify_track_id'], 'series': rows(ctx.con, query, [ctx.dataset, ti['spotify_track_id'], ctx.end, *cal])})
    records = rows(ctx.con, *track_records(ctx, isrc))
    milestones = rows(ctx.con, '''select m.* from src_milestones m where (?='stats2' or m.in_stats_dump)
      and cast(m.created_at as date) between ? and ? and exists(
        select 1 from track_identity ti, unnest(ti.names_seen) n(v) where ti.isrc=? and n.v.song_name=m.song_name and n.v.artist=m.artist) order by created_at''', [ctx.dataset, ctx.start, ctx.end, isrc])
    membership = rows(ctx.con, '''select pt.playlist_id,coalesce(p.name,pt.playlist_id) playlist,min(pt.day) first_day,max(pt.day) last_day,count(distinct pt.day) as days
      from playlist_track_day pt join isrc_map m using(spotify_track_id) left join playlists p using(playlist_id)
      where pt.dataset=? and m.isrc=? and pt.day between ? and ? group by pt.playlist_id,p.name order by playlist''', [ctx.dataset,isrc,ctx.start,ctx.end])
    summary = rows(ctx.con, *track_query(ctx, available, isrc))
    return {'identity': identity, 'summary': summary[0] if summary else None, 'series': series, 'per_id': per_id, 'records': records, 'milestones': milestones, 'playlists': membership, 'method': CATALOG_METHOD}


def readings_query(ctx, isrc, all_days=False):
    sql = '''select s.id,s.created_at,s.playlist_id,p.name playlist_name,s.spotify_track_id,s.play_count,
      t.streams as mode,t.mode_frequency,t.observation_count,t.mode_confidence
      from src_tracks s join isrc_map m using(spotify_track_id) left join playlists p using(playlist_id)
      left join track_day t on t.dataset=? and t.spotify_track_id=s.spotify_track_id and t.day=cast(s.created_at as date)
      where m.isrc=? and (?='stats2' or s.in_stats_dump) and s.created_at>=? and s.created_at<? order by s.created_at,s.id'''
    if all_days: start, end = ctx.start, ctx.end
    else:
        from api_common import date
        if not ctx.p.get('day'): raise APIError('day is required')
        start = end = date(ctx.p['day'])
    return sql, [ctx.dataset, isrc, ctx.dataset, start, end + dt.timedelta(days=1)]


def artists_query(ctx, available):
    tq, params = track_query(ctx, available)
    sql = '''with members as (''' + tq + '''), dictionary as (
      select artist_name artist from src_artists union select distinct trim(unnest(string_split(artist,','))) from isrc_identity
      ), membership as (select *,trim(unnest(string_split(artist,','))) member from members)
      select d.artist,count(m.isrc) tracks,sum(m.latest_streams) latest_streams,sum(m.gained) gained,
      min(m.first_day) first_day,max(m.last_day) last_day from dictionary d left join membership m on m.member=d.artist where d.artist<>'' '''
    if ctx.p.get('q'): sql += ' and ' + search('d.artist'); params += [ctx.p['q']]
    return sql + ' group by d.artist', params


ARTIST_SORTS = {'artist','tracks','latest_streams','gained','first_day','last_day'}


def artists(ctx, available, export=False):
    # q searches the dictionary, not the tracks it aggregates.
    p = dict(ctx.p); p.pop('q', None); p.pop('artist', None)
    base = Context(ctx.con, p, {ctx.dataset: (ctx.start, ctx.end)})
    sql, params = artists_query(base, available)
    if ctx.p.get('q'):
        sql = 'select * from (' + sql + ') a where ' + search('artist'); params += [ctx.p['q']]
    return ctx.page(sql, params, ARTIST_SORTS, 'latest_streams', export)


def artist_series(ctx, name):
    # Bucket each member independently, then sum, as required; NULL members are
    # absent, never coerced to zero. State membership coverage explicitly.
    grain = ctx.grain
    sql = '''with member_days as (select d.* from isrc_day d join isrc_identity i using(isrc)
      where d.dataset=? and list_contains(list_transform(string_split(i.artist,','),x->trim(x)),?) and d.day<=?),
      span as (select isrc,min(day) f,max(day) l from member_days group by isrc),
      daily0 as (select day,sum(streams) raw_streams,sum(delta) net,count(streams) tracks from member_days group by day),
      expd as (select d.day,count(*) expected from daily0 d join span s on d.day between s.f and s.l group by d.day),
      daily as (select d.day,case when d.tracks>=0.9*e.expected then d.raw_streams end streams,d.net,d.tracks,e.expected
                from daily0 d join expd e using(day))'''
    daily_sql = sql + ' select * from daily'
    dense, cal = with_calendar(daily_sql, ctx, 'net')
    query = bucket_sql(dense, grain, ('streams','tracks'), ('net',), ma_column='net')
    if grain != 'day':
        query = '''with members as (select cast(date_trunc(''' + "'" + grain + "'" + ''',d.day) as date) bucket,d.isrc,arg_max(d.streams,d.day) streams
          from isrc_day d join isrc_identity i using(isrc) where d.dataset=? and list_contains(list_transform(string_split(i.artist,','),x->trim(x)),?) and d.day between ? and ? group by 1,2),
          buckets as (''' + query + ''') select b.* exclude(streams,tracks),m.streams,m.tracks from buckets b left join (select bucket,sum(streams) streams,count(streams) tracks from members group by bucket) m using(bucket) order by bucket'''
        return query, [ctx.dataset,name,ctx.start,ctx.end,ctx.dataset,name,ctx.end,*cal]
    return query, [ctx.dataset,name,ctx.end,*cal]


def artist(ctx, name, available):
    p = dict(ctx.p); p['artist'] = name; p.pop('q', None)
    base = Context(ctx.con,p,{ctx.dataset: (ctx.start,ctx.end)})
    tq, tp = track_query(base,available)
    track_rows = rows(ctx.con,tq+' order by latest_streams desc nulls last',tp)
    exists = ctx.con.execute("select count(*) from src_artists where artist_name=?",[name]).fetchone()[0] or ctx.con.execute("select count(*) from isrc_identity where list_contains(list_transform(string_split(artist,','),x->trim(x)),?)",[name]).fetchone()[0]
    if not exists: raise APIError('Artist not found',404)
    return {'artist':name, 'series': rows(ctx.con,*artist_series(ctx,name)), 'top_tracks': track_rows[:20], 'tracks':track_rows,
            'notes':['Counters sum member ISRCs; a day is blank when fewer than 90% of the tracks of this artist being tracked at the time were read. Weekly/monthly totals sum each member\'s last non-null counter inside the bucket; daily net sums non-null member deltas.']}


def playlists_query(ctx):
    return '''select p.playlist_id,p.name,p.short_name,p.persons,p.groups,min(d.day) first_day,max(d.day) last_day,
      arg_max(d.total_track_mode,d.day) total,arg_max(d.tracks_observed,d.day) tracks,count(d.day) as days
      from playlists p join playlist_day d using(playlist_id) where d.dataset=? and d.day between ? and ?
      group by p.playlist_id,p.name,p.short_name,p.persons,p.groups order by total desc nulls last''', [ctx.dataset,ctx.start,ctx.end]


def playlist(ctx, pid, available):
    identity = one(ctx.con,'select * from playlists where playlist_id=?',[pid])
    if not identity: raise APIError('Playlist not found',404)
    p = dict(ctx.p); p['playlist']=pid
    base = Context(ctx.con,p,{ctx.dataset:(ctx.start,ctx.end)})
    result = overview(base,available)
    tq,tp=track_query(base,available)
    result.update({'playlist':identity,'tracks':rows(ctx.con,'''select t.*,m.first_day membership_first_day,m.last_day membership_last_day from (''' + tq + ''') t join (
      select im.isrc,min(pt.day) first_day,max(pt.day) last_day from playlist_track_day pt join isrc_map im using(spotify_track_id)
      where pt.dataset=? and pt.playlist_id=? and pt.day between ? and ? group by im.isrc) m using(isrc) order by latest_streams desc nulls last''',[*tp,ctx.dataset,pid,ctx.start,ctx.end])})
    return result
