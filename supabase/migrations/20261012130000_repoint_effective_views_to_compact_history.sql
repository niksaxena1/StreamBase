-- Phase 2 / step 1: make the history-aware base the single source for all readers.
--
-- <schema>.track_daily_streams_base_all = daily rows from stream_history_hot_from() onward
--   UNION ALL packed months expanded through a calendar join (so date / isrc / date-range predicates
--   prune to the needed months instead of unnesting the whole compact table).
-- <schema>.track_daily_streams_all (existing, same column list) now selects from it.
-- <schema>.track_daily_streams_effective (existing, same 10 columns/types/order) now reads base values
--   from it; *_effective_public selects from *_effective and is untouched (grants unchanged).
-- Packed months return NULL for source_run_id / base_created_at (not retained when packing).
-- Calendar horizon: 2025-01-01 .. 2035-12-31 (4018 days).

------------------------------------------------------------------------------
-- PUBLIC
------------------------------------------------------------------------------
create or replace view public.track_daily_streams_base_all as
  select t.date, t.isrc, t.streams_cumulative, t.source_run_id, t.created_at as base_created_at
  from public.track_daily_streams t
  where t.date >= public.stream_history_hot_from()
  union all
  select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
         null::uuid as source_run_id, null::timestamptz as base_created_at
  from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)) c
  join public.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
  where m.month < public.stream_history_hot_from()
    and m.vals[extract(day from c.d)::int] is not null;
revoke all on public.track_daily_streams_base_all from anon, authenticated;
grant select on public.track_daily_streams_base_all to service_role;

create or replace view public.track_daily_streams_all as
  select b.date, b.isrc, b.streams_cumulative
  from public.track_daily_streams_base_all b;

create or replace view public.track_daily_streams_effective as
  select t.date,
         t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative,
         t.source_run_id,
         t.base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from public.track_daily_streams_base_all t
  left join public.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
  union all
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::uuid as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from public.track_daily_stream_overrides o
  where not exists (select 1 from public.track_daily_streams_base_all t where t.date = o.date and t.isrc = o.isrc);

------------------------------------------------------------------------------
-- COMPETITOR
------------------------------------------------------------------------------
create or replace view competitor.track_daily_streams_base_all as
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total, t.source_run_id, t.created_at as base_created_at
  from competitor.track_daily_streams t
  where t.date >= competitor.stream_history_hot_from()
  union all
  select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
         competitor.stream_est_revenue(m.vals[extract(day from c.d)::int]) as est_revenue_total,
         null::bigint as source_run_id, null::timestamptz as base_created_at
  from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)) c
  join competitor.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
  where m.month < competitor.stream_history_hot_from()
    and m.vals[extract(day from c.d)::int] is not null;
revoke all on competitor.track_daily_streams_base_all from anon, authenticated;
grant select on competitor.track_daily_streams_base_all to service_role;

create or replace view competitor.track_daily_streams_all as
  select b.date, b.isrc, b.streams_cumulative, b.est_revenue_total
  from competitor.track_daily_streams_base_all b;

create or replace view competitor.track_daily_streams_effective as
  select t.date,
         t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative,
         t.source_run_id,
         t.base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from competitor.track_daily_streams_base_all t
  left join competitor.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
  union all
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::bigint as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from competitor.track_daily_stream_overrides o
  where not exists (select 1 from competitor.track_daily_streams_base_all t where t.date = o.date and t.isrc = o.isrc);
