-- Phase 3: reader hardening for the archive tier.
-- A) history readers that merge <base> with overrides read overrides_all (DB overrides + archived overrides not
--    shadowed by a DB override) so overrides on archived months keep applying.
-- B) readers that scanned ALL history without a lower date bound are bounded to the compact+daily window
--    (stream_compact_from()). Today compact_from is the first month of data, so outputs are identical; once months are
--    archived these readers simply do not look back into R2 (normal pages never hit R2).
do $$
declare
  r record;
  def text;
  newdef text;
begin
  -- A) overrides -> overrides_all
  for r in select * from (values
      ('competitor.catalog_artist_series_fast(text,date,date)'::text, 'competitor'::text),
      ('competitor.health_daily_stream_totals(date,date,text)', 'competitor'),
      ('competitor.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date,text)', 'competitor'),
      ('competitor.home_artist_weekend_dips(numeric,date,text)', 'competitor'),
      ('competitor.home_negative_daily_streams(text)', 'competitor'),
      ('competitor.home_track_scatter_points_for_label(text,date,date)', 'competitor'),
      ('competitor.home_track_weekend_dips(numeric,date,text)', 'competitor'),
      ('public.catalog_artist_series_fast(text,date,date)', 'public'),
      ('public.health_daily_stream_totals(date,date)', 'public'),
      ('public.playlist_top_tracks(text,date,date,integer)', 'public')
    ) as v(sig, sch)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := regexp_replace(def, r.sch || '\.track_daily_stream_overrides(?![A-Za-z0-9_])',
                             r.sch || '.track_daily_stream_overrides_all', 'g');
    if newdef = def then
      raise exception 'overrides repoint: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;

  def := pg_get_functiondef('public.effective_streams_for_date(date)'::regprocedure);
  newdef := replace(def, 'JOIN track_daily_stream_overrides o', 'JOIN public.track_daily_stream_overrides_all o');
  if newdef = def then
    raise exception 'overrides repoint: no change for effective_streams_for_date';
  end if;
  execute newdef;

  -- B) bounds
  def := pg_get_functiondef('competitor.home_negative_daily_streams(text)'::regprocedure);
  newdef := replace(def, 'WHERE b.isrc = ANY ($1)', 'WHERE b.isrc = ANY ($1) AND b.date >= competitor.stream_compact_from()');
  newdef := replace(newdef, 'WHERE o.isrc = ANY ($1)', 'WHERE o.isrc = ANY ($1) AND o.date >= competitor.stream_compact_from()');
  if newdef = def then raise exception 'bound: no change for competitor.home_negative_daily_streams'; end if;
  execute newdef;

  def := pg_get_functiondef('competitor.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date,text)'::regprocedure);
  newdef := replace(def, 'COALESCE($7::date, ''-infinity''::date)',
                    'GREATEST(COALESCE($7::date, ''-infinity''::date), competitor.stream_compact_from())');
  if newdef = def then raise exception 'bound: no change for competitor.home_artificial_stream_spikes'; end if;
  execute newdef;

  def := pg_get_functiondef('public.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date)'::regprocedure);
  newdef := replace(def, 'WHERE (p_start_date IS NULL OR tds.date::date >= p_start_date)',
                    'WHERE tds.date >= public.stream_compact_from() AND (p_start_date IS NULL OR tds.date::date >= p_start_date)');
  if newdef = def then raise exception 'bound: no change for public.home_artificial_stream_spikes'; end if;
  execute newdef;

  def := pg_get_functiondef('public.health_unplayable_candidates(date,integer)'::regprocedure);
  newdef := regexp_replace(def, 'WHERE s\.date < \$1(\s+GROUP BY s\.isrc)', 'WHERE s.date < $1 AND s.date >= public.stream_compact_from()\1');
  if newdef = def then raise exception 'bound: no change for health_unplayable_candidates'; end if;
  execute newdef;

  def := pg_get_functiondef('public._latest_data_sunday(interval,date)'::regprocedure);
  newdef := replace(def, 'd := hi - k;', 'd := hi - k;' || E'\n    exit when d < public.stream_compact_from();');
  if newdef = def then raise exception 'bound: no change for _latest_data_sunday'; end if;
  execute newdef;
end
$$;

create or replace function public.home_negative_daily_streams()
returns table (isrc text, name text, artist_names text[], artist_ids text[], album_image_url text,
               date date, daily_streams_delta bigint, total_streams_cumulative bigint)
language sql stable
set search_path = public, pg_temp
as $f$
  select
    t.isrc,
    coalesce(t.name, t.isrc)::text as name,
    t.spotify_artist_names::text[] as artist_names,
    t.spotify_artist_ids::text[] as artist_ids,
    t.spotify_album_image_url::text as album_image_url,
    d.date,
    (d.cur - d.prev)::bigint as daily_streams_delta,
    d.cur::bigint as total_streams_cumulative
  from (
    select e.isrc, e.date, e.streams_cumulative as cur,
           lag(e.streams_cumulative) over w as prev,
           lag(e.date) over w as prev_date
    from public.track_daily_streams_effective_public e
    where e.date >= public.stream_compact_from()
    window w as (partition by e.isrc order by e.date)
  ) d
  join public.tracks t on t.isrc = d.isrc
  where d.prev_date = d.date - 1
    and d.cur < d.prev
  order by d.date desc, daily_streams_delta asc
$f$;
