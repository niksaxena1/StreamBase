-- Follow-up 2: probe only the one physical source that can hold the override date (CASE guarantees a single
-- index lookup per override row) instead of two anti joins.
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
  where case
          when o.date >= public.stream_history_hot_from()
            then not exists (select 1 from public.track_daily_streams t where t.date = o.date and t.isrc = o.isrc)
          else not exists (select 1 from public.track_streams_monthly m
                           where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                             and m.vals[extract(day from o.date)::int] is not null)
        end;

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
  where case
          when o.date >= competitor.stream_history_hot_from()
            then not exists (select 1 from competitor.track_daily_streams t where t.date = o.date and t.isrc = o.isrc)
          else not exists (select 1 from competitor.track_streams_monthly m
                           where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                             and m.vals[extract(day from o.date)::int] is not null)
        end;
