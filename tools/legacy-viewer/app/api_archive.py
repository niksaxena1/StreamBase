"""Milestones and audit/quality endpoints."""
import datetime as dt
import json

from api_common import order, rows, search

LOFI = ('Joongle','DOSA','Piple','sad app','tsambar','dokha','five fi')
QUALITY_NOTES = [
    'F1: per-track UTC day mode, ties choose the higher reading. F2: per-playlist mode of hourly SUMs, then SUM playlists. F3: hourly per-track MAX, then SUM tracks. These methods legitimately differ.',
    'Explorer uses MAX across Spotify IDs linked to one ISRC; Grafana name-based panels can SUM linked IDs and double count.',
    'All days are UTC calendar dates; archived Grafana displayed browser-local times.',
    'Original relative NOW() panels anchor to the last observation in that dataset, rather than the viewing date.',
    'Missing is not zero. Net is NULL across gaps or resets; catalog net is masked when more than 10% of tracks lack consecutive prior data.',
]


def milestone_query(ctx):
    sql = '''with ranked as (select *,row_number() over(partition by song_name,artist order by created_at desc,id desc)=1 is_latest_for_track
      from src_milestones where (?='stats2' or in_stats_dump)) select * from ranked where cast(created_at as date) between ? and ?'''
    params=[ctx.dataset,ctx.start,ctx.end]
    if ctx.p.get('milestone'):
        sql+=' and milestone=?'; params.append(ctx.p['milestone'])
    if ctx.p.get('q'):
        sql+=' and '+search("song_name || ' ' || artist"); params.append(ctx.p['q'])
    if ctx.p.get('exclude_lofi','0') == '1':
        for artist in LOFI:
            sql+=' and artist not ilike ?'; params.append('%'+artist+'%')
    return sql,params


def milestones(ctx,export=False):
    sql,params=milestone_query(ctx)
    result=ctx.page(sql,params,{'created_at','song_name','artist','milestone','play_count','id'},'created_at',export)
    if export: return result
    ladder=rows(ctx.con,'''select milestone,count(distinct (song_name,artist)) tracks,
      try_cast(regexp_extract(milestone,'([0-9.]+)',1) as double) *
      case when upper(milestone) like '%B%' then 1000000000 when upper(milestone) like '%M%' then 1000000
      when upper(milestone) like '%K%' then 1000 else 1 end as value from ('''+sql+') m group by milestone order by value',params)
    result['summary']={'ladder':ladder,'per_day':rows(ctx.con,'select cast(created_at as date) as day,count(*) count from ('+sql+') m group by day order by day',params)}
    result['notes']=['is_latest_for_track selects the latest timestamp/id in the selected dataset, before date/search/lofi filters.',
      'exclude_lofi=1 reproduces the original Milestones (Without Lofi) predicate: '+ ' AND '.join("artist NOT ILIKE '%"+a+"%'" for a in LOFI)+'.']
    return result


def reset_query(ctx):
    return '''select d.isrc,i.song_name,i.artist,d.day,d.raw_delta delta,d.streams from isrc_day d join isrc_identity i using(isrc)
      where d.dataset=? and d.is_reset and d.day between ? and ? order by d.day,d.isrc''',[ctx.dataset,ctx.start,ctx.end]


def quality(ctx,meta):
    # Count every raw reading across linked IDs, not only the ID selected by MAX.
    coverage=rows(ctx.con,'''with observations as (
      select day,sum(observation_count) observations from track_day where dataset=? group by day)
      select c.day,c.tracks,c.low_coverage,c.missing_prev,c.resets,o.observations
      from catalog_day c join observations o using(day) where c.dataset=? order by c.day''',[ctx.dataset,ctx.dataset])
    gaps=[]
    for prev,cur in zip(coverage,coverage[1:]):
        length=(cur['day']-prev['day']).days-1
        if length>0: gaps.append({'from':prev['day']+dt.timedelta(days=1),'to':cur['day']-dt.timedelta(days=1),'days':length})
    low=rows(ctx.con,"select cast(date_trunc('month',day) as date) as month,count(*) count from isrc_day where dataset=? and mode_confidence<0.5 group by 1 order by 1",[ctx.dataset])
    disagree=rows(ctx.con,'''with spread as (
      select d.isrc,d.day,max(t.streams)-min(t.streams) difference,max(d.source_id_count) ids,max(d.observation_count) observations
      from isrc_day d join track_day t on t.dataset=d.dataset and t.isrc=d.isrc and t.day=d.day
      where d.dataset=? and d.ids_disagree group by d.isrc,d.day)
      select s.isrc,i.song_name,i.artist,count(*) as days,max(s.ids) ids,max(s.difference) max_difference,
      sum(s.observations) observations from spread s join isrc_identity i using(isrc)
      group by s.isrc,i.song_name,i.artist order by max_difference desc,days desc limit 20''',[ctx.dataset])
    return {'coverage':coverage,'calendar_gaps':gaps,'resets':rows(ctx.con,*reset_query(ctx)),'low_confidence':low,
      'linked_id_disagreements':{'count':ctx.con.execute('select count(*) from isrc_day where dataset=? and ids_disagree',[ctx.dataset]).fetchone()[0],'top':disagree},
      'verification':{k:v for k,v in meta.items() if 'check' in k or 'verified' in k},'notes':QUALITY_NOTES}


def archive(con):
    result=rows(con,'select * from archive_inventory order by relative_path')
    for r in result:
        if r.get('toc_summary'): r['toc_summary']=json.loads(r['toc_summary'])
    return {'rows':result,'notes':['Only paths, file sizes, manifest checksums and descriptions are displayed; configuration/security file contents are never read. Dump table/count summaries come from verified build meta.']}
