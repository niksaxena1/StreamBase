"""Followers use the per-playlist daily MODE (tie -> higher); Grafana's daily MAX is kept alongside."""
import datetime as dt

from api_common import APIError, bucket_sql, one, rows, search, with_calendar


def filter_sql(ctx, alias='p'):
    sql, params = '', []
    if ctx.p.get('account'):
        sql += ' and list_contains(' + alias + '.account_names,?)'; params.append(ctx.p['account'])
    if ctx.p.get('group'):
        sql += ' and list_contains(' + alias + '.dashboard_groups,?)'; params.append(ctx.p['group'])
    if ctx.p.get('q'):
        sql += ' and ' + search(alias + ".name || ' ' || " + alias + ".playlist_id || ' ' || coalesce(" + alias + ".account_name,'')"); params.append(ctx.p['q'])
    return sql, params


def playlists_query(ctx):
    filt, fp = filter_sql(ctx)
    sql = '''with history as (
      select playlist_id,arg_max(followers_mode,day) latest_followers,
      arg_max(followers_mode,day) filter(where day<?) baseline,
      arg_min(followers_mode,day) filter(where day>=?) first_in_range,
      max(day) latest_day,sum(readings) filter(where day>=?) range_readings
      from pf_playlist_day where day<=? group by playlist_id
      ) select p.playlist_id,p.name,p.account_name account,p.user_id,p.dashboard_groups as groups,
      h.latest_followers,h.latest_followers-coalesce(h.baseline,h.first_in_range) change,
      h.baseline is null and h.first_in_range is not null started_in_range,p.first_reading,p.last_reading,
      p.readings,h.range_readings,h.latest_day from pf_playlists p left join history h using(playlist_id) where true'''
    return sql + filt, [ctx.start,ctx.start,ctx.start,ctx.end,*fp]


SORTS = {'name','account','latest_followers','change','first_reading','last_reading','readings','latest_day'}


def playlists(ctx, export=False):
    return ctx.page(*playlists_query(ctx),SORTS,'latest_followers',export)


def overview_query(ctx):
    filt, fp = filter_sql(ctx)
    # Like-for-like change: only playlists with readings on both consecutive UTC days
    # contribute, so a playlist missing for a day (or newly added) can't fake a dip/jump.
    daily = '''select d.day,sum(d.followers_mode) total_followers,count(d.followers_mode) playlists_reporting,
      sum(d.delta) daily_change,count(d.delta) playlists_with_change
      from (select x.*,case when lag(x.day) over w=x.day-1 then x.followers_mode-lag(x.followers_mode) over w end delta
            from pf_playlist_day x window w as (partition by x.playlist_id order by x.day)) d
      join pf_playlists p using(playlist_id) where d.day<=?''' + filt + ' group by d.day'
    dense, cal = with_calendar(daily,ctx,'daily_change')
    query = bucket_sql(dense,ctx.grain,('total_followers','playlists_reporting'),('daily_change',),ma_column='daily_change')
    return query, [ctx.end,*fp,*cal], daily, [ctx.end,*fp]


def overview(ctx):
    sql,params,daily,dp=overview_query(ctx)
    series=rows(ctx.con,sql,params)
    pq,pp=playlists_query(ctx)
    kpis=one(ctx.con,'''select count(*) playlists,count(distinct account) accounts,sum(latest_followers) total_latest,
      sum(change) change_in_range,count(*) filter(where latest_followers=0) zero_follower_playlists
      from (''' + pq + ') p',pp)
    # Aggregate range change uses the aggregate counter at each boundary, not a
    # sum of individually selected latest days (which is separately total_latest).
    # change_in_range = sum of each playlist's own change (from the playlists query);
    # total_change also includes playlists entering/leaving collection.
    from api_streams import gained
    g=gained(ctx,daily,dp,'total_followers')
    kpis['total_change']=g['gained']; kpis['started_in_range']=g['started_in_range']
    kpis['latest_daily_total']=one(ctx.con,'select arg_max(total_followers,day) total from ('+daily+') d',dp)['total']
    return {'series':series,'kpis':kpis,'method':'Total = SUM of per-playlist UTC daily MODE of readings (tie -> higher); daily change is like-for-like across consecutive days. Grafana used the daily MAX (see Original dashboards).',
      'notes':['daily_change sums per-playlist changes between consecutive UTC days for playlists reporting on both days (like-for-like); Grafana subtracted consecutive totals, so missing playlists showed as dips. change_in_range sums every playlist\'s own change; total_change is the raw change of the summed total. total_latest sums each playlist\'s latest non-null daily MAX on or before to; reporting dates may differ.']}


def playlist_query(ctx,pid):
    daily = '''select day,followers_mode daily_mode,mode_frequency,followers_max daily_max,followers_last daily_last,readings,zero_readings,null_readings,
      case when lag(day) over(order by day)=day-1 then followers_mode-lag(followers_mode) over(order by day) end daily_change
      from pf_playlist_day where playlist_id=? and day<=?'''
    dense,cal=with_calendar(daily,ctx,'daily_change')
    query=bucket_sql(dense,ctx.grain,('daily_mode','daily_max','daily_last'),('readings','zero_readings','null_readings','daily_change'),ma_column='daily_change')
    return query,[pid,ctx.end,*cal]


def playlist(ctx,pid):
    identity=one(ctx.con,'select * from pf_playlists where playlist_id=?',[pid])
    if not identity: raise APIError('Follower playlist not found',404)
    hourly=[]
    if ctx.days<=31:
        # Bounded even for unexpectedly frequent historical collectors.
        hourly=rows(ctx.con,'''select * from pf_followers where playlist_id=? and timestamp>=? and timestamp<? order by timestamp limit 5000''',[pid,ctx.start,ctx.end+dt.timedelta(days=1)])
    return {'playlist':identity,'series':rows(ctx.con,*playlist_query(ctx,pid)),'hourly':hourly,
      'notes':['daily_max is Grafana\'s chosen value; daily_last is the last non-null reading, with zero/null reading counts. Raw hourly readings are included for ranges of at most 31 dates (5000 maximum).']}


def accounts_query(ctx):
    pq,pp=playlists_query(ctx)
    return '''select p.account,p.user_id,count(*) playlists,sum(latest_followers) total_latest_followers,sum(change) change
      from (''' + pq + ') p group by p.account,p.user_id order by total_latest_followers desc nulls last',pp
