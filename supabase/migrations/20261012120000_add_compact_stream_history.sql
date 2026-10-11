-- Compact stream history (additive only).
-- Old complete months of track_daily_streams are packed into one row per (isrc, month)
-- with a bigint[] of daily values (array index = day-of-month, NULL = no row that day).
-- The daily partitioned tables are NOT touched here. See docs/COMPACT-STREAM-STORAGE.md.
--
-- Own catalog (public) and competitor schemas are kept strictly separate.
-- competitor.est_revenue_total is derivable (streams * 0.002 in float8, shortest-roundtrip text),
-- verified exact on every row, so it is not stored; pack_stream_month re-verifies that per month.

------------------------------------------------------------------------------
-- PUBLIC (own catalog)
------------------------------------------------------------------------------
create table if not exists public.track_streams_monthly (
  isrc      text        not null,
  month     date        not null,
  vals      bigint[]    not null,
  packed_at timestamptz not null default now(),
  primary key (isrc, month),
  constraint track_streams_monthly_month_first_day check (month = date_trunc('month', month)::date)
);
create index if not exists track_streams_monthly_month_idx on public.track_streams_monthly (month);
alter table public.track_streams_monthly enable row level security;
revoke all on public.track_streams_monthly from anon, authenticated;
grant all on public.track_streams_monthly to service_role;

-- First day that is still served from the daily table (everything before it is served from the compact table).
create or replace function public.stream_history_hot_from()
returns date language sql stable
as $$
  select coalesce((select max(m.month) from public.track_streams_monthly m) + interval '1 month', date '0001-01-01')::date
$$;

create or replace function public.pack_stream_month(p_month date)
returns bigint language plpgsql
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  ndays int;
  n bigint;
begin
  if m + interval '1 month' > current_date then
    raise exception 'pack_stream_month: % is not a complete month yet', m;
  end if;
  ndays := extract(day from (m + interval '1 month' - interval '1 day'))::int;
  if exists (select 1 from public.track_daily_streams t
             where t.date >= m and t.date < m + interval '1 month' and t.streams_cumulative is null) then
    raise exception 'pack_stream_month: NULL streams_cumulative in %, cannot pack', m;
  end if;

  insert into public.track_streams_monthly as c (isrc, month, vals)
  select g.isrc, m,
         array(select (select g.vs[i] from generate_subscripts(g.ds, 1) i where g.ds[i] = d)
               from generate_series(1, ndays) d)
  from (
    select t.isrc,
           array_agg(extract(day from t.date)::int) as ds,
           array_agg(t.streams_cumulative) as vs
    from public.track_daily_streams t
    where t.date >= m and t.date < m + interval '1 month'
    group by t.isrc
  ) g
  on conflict (isrc, month) do update set vals = excluded.vals, packed_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Range reader: only touches the months the range needs. p_isrcs null = all tracks.
create or replace function public.track_daily_streams_range(p_start date, p_end date, p_isrcs text[] default null)
returns table (date date, isrc text, streams_cumulative bigint)
language sql stable
as $$
  select t.date, t.isrc, t.streams_cumulative
  from public.track_daily_streams t
  where t.date >= greatest(p_start, public.stream_history_hot_from())
    and t.date <= p_end
    and (p_isrcs is null or t.isrc = any (p_isrcs))
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v
  from public.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < public.stream_history_hot_from()
    and (p_isrcs is null or m.isrc = any (p_isrcs))
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

-- Full-history view (same columns as the analytics columns of the base table).
create or replace view public.track_daily_streams_all as
  select t.date, t.isrc, t.streams_cumulative
  from public.track_daily_streams t
  where t.date >= public.stream_history_hot_from()
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v as streams_cumulative
  from public.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month < public.stream_history_hot_from()
    and u.v is not null;
revoke all on public.track_daily_streams_all from anon, authenticated;
grant select on public.track_daily_streams_all to service_role;

revoke all on function public.pack_stream_month(date) from public, anon, authenticated;
grant execute on function public.pack_stream_month(date) to service_role;
grant execute on function public.track_daily_streams_range(date, date, text[]) to service_role;
grant execute on function public.stream_history_hot_from() to service_role;

------------------------------------------------------------------------------
-- COMPETITOR
------------------------------------------------------------------------------
create table if not exists competitor.track_streams_monthly (
  isrc      text        not null,
  month     date        not null,
  vals      bigint[]    not null,
  packed_at timestamptz not null default now(),
  primary key (isrc, month),
  constraint competitor_track_streams_monthly_month_first_day check (month = date_trunc('month', month)::date)
);
create index if not exists competitor_track_streams_monthly_month_idx on competitor.track_streams_monthly (month);
alter table competitor.track_streams_monthly enable row level security;
revoke all on competitor.track_streams_monthly from anon, authenticated;
grant all on competitor.track_streams_monthly to service_role;

-- est_revenue_total == streams * 0.002 computed in float8 and stored via shortest round-trip text.
create or replace function competitor.stream_est_revenue(p_streams bigint)
returns numeric language sql immutable
set extra_float_digits = 3
as $$ select (p_streams * 0.002::float8)::text::numeric $$;

create or replace function competitor.stream_history_hot_from()
returns date language sql stable
as $$
  select coalesce((select max(m.month) from competitor.track_streams_monthly m) + interval '1 month', date '0001-01-01')::date
$$;

create or replace function competitor.pack_stream_month(p_month date)
returns bigint language plpgsql
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  ndays int;
  n bigint;
begin
  if m + interval '1 month' > current_date then
    raise exception 'pack_stream_month: % is not a complete month yet', m;
  end if;
  ndays := extract(day from (m + interval '1 month' - interval '1 day'))::int;
  if exists (select 1 from competitor.track_daily_streams t
             where t.date >= m and t.date < m + interval '1 month' and t.streams_cumulative is null) then
    raise exception 'pack_stream_month: NULL streams_cumulative in %, cannot pack', m;
  end if;
  if exists (select 1 from competitor.track_daily_streams t
             where t.date >= m and t.date < m + interval '1 month'
               and t.est_revenue_total is distinct from competitor.stream_est_revenue(t.streams_cumulative)) then
    raise exception 'pack_stream_month: est_revenue_total is not streams*0.002 in %, cannot omit it', m;
  end if;

  insert into competitor.track_streams_monthly as c (isrc, month, vals)
  select g.isrc, m,
         array(select (select g.vs[i] from generate_subscripts(g.ds, 1) i where g.ds[i] = d)
               from generate_series(1, ndays) d)
  from (
    select t.isrc,
           array_agg(extract(day from t.date)::int) as ds,
           array_agg(t.streams_cumulative) as vs
    from competitor.track_daily_streams t
    where t.date >= m and t.date < m + interval '1 month'
    group by t.isrc
  ) g
  on conflict (isrc, month) do update set vals = excluded.vals, packed_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function competitor.track_daily_streams_range(p_start date, p_end date, p_isrcs text[] default null)
returns table (date date, isrc text, streams_cumulative bigint, est_revenue_total numeric)
language sql stable
as $$
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total
  from competitor.track_daily_streams t
  where t.date >= greatest(p_start, competitor.stream_history_hot_from())
    and t.date <= p_end
    and (p_isrcs is null or t.isrc = any (p_isrcs))
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v, competitor.stream_est_revenue(u.v)
  from competitor.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < competitor.stream_history_hot_from()
    and (p_isrcs is null or m.isrc = any (p_isrcs))
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

create or replace view competitor.track_daily_streams_all as
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total
  from competitor.track_daily_streams t
  where t.date >= competitor.stream_history_hot_from()
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v as streams_cumulative,
         competitor.stream_est_revenue(u.v) as est_revenue_total
  from competitor.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month < competitor.stream_history_hot_from()
    and u.v is not null;
revoke all on competitor.track_daily_streams_all from anon, authenticated;
grant select on competitor.track_daily_streams_all to service_role;

revoke all on function competitor.pack_stream_month(date) from public, anon, authenticated;
grant execute on function competitor.pack_stream_month(date) to service_role;
grant execute on function competitor.track_daily_streams_range(date, date, text[]) to service_role;
grant execute on function competitor.stream_history_hot_from() to service_role;
grant execute on function competitor.stream_est_revenue(bigint) to service_role;
