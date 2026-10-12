-- Phase 2 / step 2: SQL functions that read the daily table directly and can be asked for dates older than
-- the hot window now read the history-aware views (<schema>.track_daily_streams_all).
-- Done programmatically from the live definitions so no function body is retyped; every rewrite is asserted
-- to have changed the definition. Functions that only ever look at the last ~4 months stay on the daily table
-- (listed in docs/COMPACT-STREAM-STORAGE.md).
do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in
    select * from (values
      ('public.catalog_artist_series_fast(text,date,date)'::text,  'public'::text),
      ('public.collector_artists_stats_paged(text,date,integer,integer)', 'public'),
      ('public.health_missing_catalog_tracks_detailed(date)', 'public'),
      ('public.playlist_top_tracks(text,date,date,integer)', 'public'),
      ('public.health_daily_stream_totals(date,date)', 'public'),
      ('competitor.catalog_artist_series_fast(text,date,date)', 'competitor'),
      ('competitor.health_daily_stream_totals(date,date,text)', 'competitor'),
      ('competitor.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date,text)', 'competitor'),
      ('competitor.home_negative_daily_streams(text)', 'competitor'),
      ('competitor.home_track_scatter_points_for_label(text,date,date)', 'competitor'),
      ('competitor.home_artist_weekend_dips(numeric,date,text)', 'competitor'),
      ('competitor.home_track_weekend_dips(numeric,date,text)', 'competitor')
    ) as v(sig, sch)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := def;
    if r.sig like '%weekend_dips%' then
      -- keep max(date) on the daily table (always recent); lower loop bound also considers the first packed month
      newdef := replace(newdef, 'SELECT max(b.date) FROM ' || r.sch || '.track_daily_streams b', 'SELECT max(b.date) FROM @@DAILY@@ b');
      newdef := replace(newdef, 'SELECT min(b.date) FROM ' || r.sch || '.track_daily_streams b',
        'SELECT LEAST(min(b.date), (SELECT min(m.month) FROM ' || r.sch || '.track_streams_monthly m)) FROM @@DAILY@@ b');
    end if;
    newdef := regexp_replace(newdef, r.sch || '\.track_daily_streams(?![A-Za-z0-9_])', r.sch || '.track_daily_streams_all', 'g');
    newdef := replace(newdef, '@@DAILY@@', r.sch || '.track_daily_streams');
    if newdef = def then
      raise exception 'repoint: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;

  -- public.effective_streams_for_date uses an unqualified table name (search_path = public)
  def := pg_get_functiondef('public.effective_streams_for_date(date)'::regprocedure);
  newdef := replace(def, 'FROM track_daily_streams b', 'FROM public.track_daily_streams_all b');
  if newdef = def then
    raise exception 'repoint: no change for effective_streams_for_date';
  end if;
  execute newdef;
end
$$;
