-- Phase 2 / step 2c: three readers that scanned the whole effective view (or joined it to itself) get
-- single-pass / date-bounded forms. Outputs are identical (verified by hashing before/after).

-- 1) Latest "Sunday in data-date space" without scanning every effective row.
--    Candidate days are walked newest-first; the first one whose (day - lag) is a Sunday, is <= the anchor,
--    and has any effective row wins (same result as the old MAX over the whole view).
create or replace function public._latest_data_sunday(p_lag interval, p_anchor date)
returns date
language sql stable
set search_path = public, pg_temp
as $$
  with m as (
    select greatest((select max(b.date) from public.track_daily_streams b),
                    (select max(o.date) from public.track_daily_stream_overrides o)) as mx
  )
  select (c.d - p_lag)::date
  from m
  cross join generate_series(0, 800) as k(k)
  cross join lateral (select (least(m.mx, least(coalesce(p_anchor, m.mx), m.mx) + 2) - k.k) as d) c
  where extract(dow from (c.d - p_lag)) = 0
    and (c.d - p_lag)::date <= coalesce(p_anchor, date '9999-12-31')
    and exists (select 1 from public.track_daily_streams_effective_public s where s.date = c.d)
  order by k.k
  limit 1
$$;
revoke all on function public._latest_data_sunday(interval, date) from public, anon, authenticated;
grant execute on function public._latest_data_sunday(interval, date) to service_role;

do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in select unnest(array[
      'public.home_artist_weekend_dips(numeric)',
      'public.home_artist_weekend_dips(numeric,date)',
      'public.home_track_weekend_dips(numeric)',
      'public.home_track_weekend_dips(numeric,date)'
    ]) as sig
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := regexp_replace(def,
      'SELECT MAX\(\(s\.date - p\.lag\)\)::date AS sun_data_date\s+FROM public\.track_daily_streams_effective_public s\s+JOIN params p ON TRUE\s+WHERE EXTRACT\(DOW FROM \(s\.date - p\.lag\)\) = 0(\s+AND \(\(s\.date - p\.lag\)::date\) <= p\.anchor_data_date)?',
      'SELECT public._latest_data_sunday(p.lag, ' ||
        case when r.sig like '%,date)' then 'p.anchor_data_date' else 'NULL::date' end ||
        ') AS sun_data_date FROM params p');
    if newdef = def then
      raise exception 'weekend rewrite: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;
end
$$;

-- 2) Negative daily deltas: one ordered pass with lag() instead of a self join of the full view.
create or replace function public.home_negative_daily_streams()
returns table (isrc text, name text, artist_names text[], artist_ids text[], album_image_url text,
               date date, daily_streams_delta bigint, total_streams_cumulative bigint)
language sql stable
set search_path = public, pg_temp
as $$
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
    window w as (partition by e.isrc order by e.date)
  ) d
  join public.tracks t on t.isrc = d.isrc
  where d.prev_date = d.date - 1
    and d.cur < d.prev
  order by d.date desc, daily_streams_delta asc
$$;

-- 3) Negative deltas for one run date: only the two relevant days are read.
create or replace function public.health_negative_daily_streams(run_date text)
returns table (isrc text, name text, artist_names text[], artist_ids text[], album_image_url text,
               daily_streams_delta bigint, total_streams_cumulative bigint)
language sql stable
set search_path = public, pg_temp
as $$
  with e as materialized (
    select s.isrc, s.date, s.streams_cumulative
    from public.track_daily_streams_effective_public s
    where s.date between run_date::date - 1 and run_date::date
  )
  select
    t.isrc,
    coalesce(t.name, t.isrc)::text as name,
    t.spotify_artist_names::text[] as artist_names,
    t.spotify_artist_ids::text[] as artist_ids,
    t.spotify_album_image_url::text as album_image_url,
    (today.streams_cumulative - prev.streams_cumulative)::bigint as daily_streams_delta,
    today.streams_cumulative::bigint as total_streams_cumulative
  from e today
  join e prev on prev.isrc = today.isrc and prev.date = (today.date - interval '1 day')::date
  join public.tracks t on t.isrc = today.isrc
  where today.date = run_date::date
    and today.streams_cumulative < prev.streams_cumulative
  order by daily_streams_delta asc
$$;
