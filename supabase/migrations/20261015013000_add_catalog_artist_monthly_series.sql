-- Precomputed per-artist monthly series for Catalog "All history" charts.
--
-- public.catalog_artist_monthly(artist_id, month, vals): vals[d] = the artist's cumulative streams on day-of-month d
-- (NULL = no point that day), i.e. exactly what the on-demand series returns:
--   months <  stream_compact_from()  -> catalog_artist_series_cold rule (carry each track's last value forward <= 7 days)
--   months >= stream_compact_from()  -> catalog_artist_series_fast rule (daily/compact tiers + overrides)
-- Refresh: hot window after ingest / override writes through refresh_home_diag_snapshots (the shared post-ingest and
-- post-override refresh point); full rebuild via catalog_artist_monthly_rebuild(). Service role only; the app reads it
-- through catalog_artist_series_precomputed() server-side. No deletes anywhere: refreshes are upserts.

create table if not exists public.catalog_artist_monthly (
  artist_id text not null,
  month date not null,
  vals bigint[] not null,
  computed_at timestamptz not null default now(),
  primary key (artist_id, month)
);

alter table public.catalog_artist_monthly enable row level security;
revoke all on public.catalog_artist_monthly from public, anon, authenticated;
grant all on public.catalog_artist_monthly to service_role;

create table if not exists public.catalog_artist_monthly_state (
  singleton boolean primary key default true check (singleton),
  override_version text,
  compact_from date,
  refreshed_at timestamptz not null default now()
);
alter table public.catalog_artist_monthly_state enable row level security;
revoke all on public.catalog_artist_monthly_state from public, anon, authenticated;
grant all on public.catalog_artist_monthly_state to service_role;

-- Internal: turn temp table p_tbl(artist text, date date, v bigint) into monthly rows (upsert only).
create or replace function public._catalog_artist_monthly_store(p_tbl text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  execute format('create index on %I (artist, date)', p_tbl);
  execute format($f$
    with g as (select distinct o.artist, date_trunc('month', o.date)::date as m from %1$I o), ins as (
      insert into public.catalog_artist_monthly as t (artist_id, month, vals, computed_at)
      select g.artist, g.m,
             array(
               select (select x.v from %1$I x where x.artist = g.artist and x.date = g.m + (d - 1))
               from generate_series(1, (extract(day from (g.m + interval '1 month' - interval '1 day')))::int) d
               order by d),
             now()
      from g
      on conflict (artist_id, month) do update set vals = excluded.vals, computed_at = excluded.computed_at
      returning 1)
    select count(*) from ins$f$, p_tbl) into n;
  return n;
end $$;

-- Cold months (< stream_compact_from()) for the given artists (null = all): same rule as catalog_artist_series_cold,
-- computed over the whole cold span per artist, with a hash-joinable plan (the on-demand function is quadratic).
create or replace function public.catalog_artist_monthly_refresh_cold(p_artists text[] default null)
returns integer
language plpgsql
set search_path = public, pg_temp
set statement_timeout = '600s'
as $$
declare cf date := public.stream_compact_from(); n integer;
begin
  if cf is null then return 0; end if;
  create temp table _cam_pts on commit drop as
    select x.artist, c.date, c.isrc, c.streams_cumulative as v
    from (
      select a.artist, array_agg(distinct t.isrc) as arr
      from public.tracks t cross join lateral unnest(t.spotify_artist_ids) as a(artist)
      where p_artists is null or a.artist = any (p_artists)
      group by a.artist
    ) x
    cross join lateral public.stream_cold_range(date '2000-01-01', cf - 1, x.arr) c;
  create index on _cam_pts (artist, isrc, date);
  analyze _cam_pts;
  create temp table _cam_out_c on commit drop as
    with dates as (select distinct p.artist, p.date from _cam_pts p),
    firsts as (select p.artist, p.isrc, min(p.date) as f from _cam_pts p group by p.artist, p.isrc),
    grid as (
      select d.artist, d.date, f.isrc, p.v
      from dates d
      join firsts f on f.artist = d.artist and d.date >= f.f
      left join _cam_pts p on p.artist = d.artist and p.isrc = f.isrc and p.date = d.date
    ),
    g1 as (select g.*, count(g.v) over (partition by g.artist, g.isrc order by g.date) as grp from grid g),
    g2 as (
      select g1.artist, g1.date, g1.isrc,
             coalesce(g1.v, max(g1.v) over (partition by g1.artist, g1.isrc, g1.grp)) as fv,
             g1.date - min(g1.date) over (partition by g1.artist, g1.isrc, g1.grp) as lag_days
      from g1
    )
    select g2.artist, g2.date, sum(g2.fv)::bigint as v
    from g2 where g2.fv is not null and g2.lag_days <= 7
    group by g2.artist, g2.date;
  n := public._catalog_artist_monthly_store('_cam_out_c');
  return n;
end $$;

-- Months >= stream_compact_from() inside [p_from, p_to] for the given artists (null = all): catalog_artist_series_fast rule.
create or replace function public.catalog_artist_monthly_refresh_hot(p_from date, p_to date, p_artists text[] default null)
returns integer
language plpgsql
set search_path = public, pg_temp
set statement_timeout = '600s'
as $$
declare cf date := public.stream_compact_from(); s date; n integer; arr text[];
begin
  s := greatest(date_trunc('month', p_from)::date, cf);
  if cf is null or s > p_to then return 0; end if;
  create temp table _cam_am on commit drop as
    select distinct a.artist, t.isrc
    from public.tracks t cross join lateral unnest(t.spotify_artist_ids) as a(artist)
    where p_artists is null or a.artist = any (p_artists);
  create index on _cam_am (isrc);
  if p_artists is null then
    create temp table _cam_base on commit drop as
      select b.date, b.isrc, b.streams_cumulative from public.track_daily_streams_range(s, p_to) b;
  else
    select array_agg(distinct isrc) into arr from _cam_am;
    create temp table _cam_base on commit drop as
      select b.date, b.isrc, b.streams_cumulative from public.track_daily_streams_range_isrcs(s, p_to, coalesce(arr, '{}')) b;
  end if;
  create temp table _cam_out_h on commit drop as
    with ov as (
      select o.date, o.isrc, o.streams_cumulative_override as v
      from public.track_daily_stream_overrides_all o
      where o.date between s and p_to and o.isrc in (select isrc from _cam_am)
    ),
    x as (
      select coalesce(b.date, o.date)::date as date, coalesce(b.isrc, o.isrc) as isrc,
             coalesce(o.v, b.streams_cumulative, 0) as v
      from _cam_base b full join ov o on o.date = b.date and o.isrc = b.isrc
    )
    select am.artist, x.date, sum(x.v)::bigint as v
    from x join _cam_am am on am.isrc = x.isrc
    group by am.artist, x.date;
  n := public._catalog_artist_monthly_store('_cam_out_h');
  return n;
end $$;

-- Full rebuild (service role / owner). p_artists null = every artist. Run from SQL or a one-shot cron job, not PostgREST
-- (API statement timeout is 8 s); pass a small artist list for per-artist repairs through the API.
create or replace function public.catalog_artist_monthly_rebuild(p_artists text[] default null)
returns integer
language plpgsql
set search_path = public, pg_temp
set statement_timeout = '600s'
as $$
declare n integer := 0;
begin
  n := n + public.catalog_artist_monthly_refresh_cold(p_artists);
  n := n + public.catalog_artist_monthly_refresh_hot(date '2000-01-01', current_date, p_artists);
  if p_artists is null then
    insert into public.catalog_artist_monthly_state (singleton, override_version, compact_from, refreshed_at)
    values (true, public.spotibase_override_version(), public.stream_compact_from(), now())
    on conflict (singleton) do update set override_version = excluded.override_version,
      compact_from = excluded.compact_from, refreshed_at = excluded.refreshed_at;
  end if;
  return n;
end $$;

-- Post-ingest / post-override hook. Does nothing until the first full rebuild has run. Refreshes the last ~40 days
-- (current + previous month); when overrides changed since the last refresh, or the compact boundary moved, it widens
-- to everything that can have changed (all months >= compact_from, plus the cold span if the boundary moved).
create or replace function public.refresh_catalog_artist_monthly(p_run_date date)
returns integer
language plpgsql
set search_path = public, pg_temp
set statement_timeout = '600s'
as $$
declare st public.catalog_artist_monthly_state%rowtype; v text; cf date; n integer := 0;
begin
  select * into st from public.catalog_artist_monthly_state where singleton;
  if not found then return 0; end if;
  v := public.spotibase_override_version();
  cf := public.stream_compact_from();
  if cf is distinct from st.compact_from then
    n := n + public.catalog_artist_monthly_refresh_cold(null);
  end if;
  if v is distinct from st.override_version or cf is distinct from st.compact_from then
    n := n + public.catalog_artist_monthly_refresh_hot(date '2000-01-01', p_run_date, null);
  else
    n := n + public.catalog_artist_monthly_refresh_hot((p_run_date - 40), p_run_date, null);
  end if;
  update public.catalog_artist_monthly_state
     set override_version = v, compact_from = cf, refreshed_at = now() where singleton;
  return n;
end $$;

-- Reader (server-side, service role): same shape as catalog_artist_series_fast / _cold.
create or replace function public.catalog_artist_series_precomputed(p_artist text, p_start date, p_end date)
returns table (date date, streams_cumulative bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select (m.month + (u.d - 1)::int) as date, u.v as streams_cumulative
  from public.catalog_artist_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.artist_id = p_artist
    and m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
  order by 1
$$;

revoke all on function public._catalog_artist_monthly_store(text) from public, anon, authenticated;
revoke all on function public.catalog_artist_monthly_refresh_cold(text[]) from public, anon, authenticated;
revoke all on function public.catalog_artist_monthly_refresh_hot(date, date, text[]) from public, anon, authenticated;
revoke all on function public.catalog_artist_monthly_rebuild(text[]) from public, anon, authenticated;
revoke all on function public.refresh_catalog_artist_monthly(date) from public, anon, authenticated;
revoke all on function public.catalog_artist_series_precomputed(text, date, date) from public, anon, authenticated;
grant execute on function public._catalog_artist_monthly_store(text) to service_role;
grant execute on function public.catalog_artist_monthly_refresh_cold(text[]) to service_role;
grant execute on function public.catalog_artist_monthly_refresh_hot(date, date, text[]) to service_role;
grant execute on function public.catalog_artist_monthly_rebuild(text[]) to service_role;
grant execute on function public.refresh_catalog_artist_monthly(date) to service_role;
grant execute on function public.catalog_artist_series_precomputed(text, date, date) to service_role;
