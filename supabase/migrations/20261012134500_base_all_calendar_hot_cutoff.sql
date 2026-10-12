-- Follow-up 3: bound the calendar side by hot_from so recent-only windows produce zero calendar rows
-- and never touch the compact table.
create or replace view public.track_daily_streams_base_all as
  select t.date, t.isrc, t.streams_cumulative, t.source_run_id, t.created_at as base_created_at
  from public.track_daily_streams t
  where t.date >= public.stream_history_hot_from()
  union all
  select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
         null::uuid as source_run_id, null::timestamptz as base_created_at
  from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)
        where date '2025-01-01' + g.i < public.stream_history_hot_from()) c
  join public.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
  where m.vals[extract(day from c.d)::int] is not null;

create or replace view competitor.track_daily_streams_base_all as
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total, t.source_run_id, t.created_at as base_created_at
  from competitor.track_daily_streams t
  where t.date >= competitor.stream_history_hot_from()
  union all
  select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
         competitor.stream_est_revenue(m.vals[extract(day from c.d)::int]) as est_revenue_total,
         null::bigint as source_run_id, null::timestamptz as base_created_at
  from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)
        where date '2025-01-01' + g.i < competitor.stream_history_hot_from()) c
  join competitor.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
  where m.vals[extract(day from c.d)::int] is not null;
