-- Source quality per stream-lookup source per day, plus a log of consolidation rejects.
-- Feeds the Health page ("Source quality (30 days)"). Service-role only.
--
-- attempts / rejects are written by scripts/rapidapi_stale_fix.py through
-- record_stream_source_attempts (NULL = not recorded, e.g. backfilled days).
-- fixes / checked / in_range are derived from track_daily_stream_overrides by
-- refresh_stream_source_quality: "checked" = SpotOnTrack's raw next-day value exists and is above the
-- previous day's effective value (so it is a usable yardstick); "in_range" = the fix lies between the
-- previous day's effective value and that next-day value.

create table if not exists public.stream_source_quality_daily (
  date date not null,
  source text not null,
  attempts integer,
  fixes integer not null default 0,
  rejects integer,
  checked integer not null default 0,
  in_range integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (date, source)
);

create table if not exists public.stream_consolidation_rejects (
  date date not null,
  isrc text not null,
  source text not null,
  value bigint,
  reason text not null,
  prev_value bigint,
  cap_value bigint,
  created_at timestamptz not null default now(),
  primary key (date, isrc, source)
);

alter table public.stream_source_quality_daily enable row level security;
alter table public.stream_consolidation_rejects enable row level security;

revoke all on table public.stream_source_quality_daily from anon, authenticated;
revoke all on table public.stream_consolidation_rejects from anon, authenticated;
grant all on table public.stream_source_quality_daily to service_role;
grant all on table public.stream_consolidation_rejects to service_role;

create index if not exists stream_consolidation_rejects_created_idx
  on public.stream_consolidation_rejects (created_at desc);

create or replace function public.record_stream_source_attempts(
  p_date date, p_source text, p_attempts integer, p_rejects integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stream_source_quality_daily as t (date, source, attempts, rejects)
  values (p_date, p_source, greatest(coalesce(p_attempts, 0), 0), greatest(coalesce(p_rejects, 0), 0))
  on conflict (date, source) do update
    set attempts = coalesce(t.attempts, 0) + excluded.attempts,
        rejects = coalesce(t.rejects, 0) + excluded.rejects,
        updated_at = now();
end;
$$;

create or replace function public.refresh_stream_source_quality(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date;
  v_rows integer;
begin
  -- Stay inside the hot window: raw next-day values are only read from the daily table.
  v_from := greatest(current_date - least(greatest(coalesce(p_days, 30), 1), 60),
                     public.stream_history_hot_from() + 1);

  with ov as (
    select o.date, o.isrc, o.streams_cumulative_override as v,
           btrim(regexp_replace(substring(o.note from '^stale-fix:\s*(.+?)\s+auto'), '\s+second-look$', '')) as src
    from public.track_daily_stream_overrides o
    where o.date >= v_from and o.date <= current_date
      and o.note ~ '^stale-fix:.*\sauto'
  ),
  scored as (
    select ov.date, ov.src, ov.v,
           coalesce(po.streams_cumulative_override, pt.streams_cumulative) as p,
           nt.streams_cumulative as n
    from ov
    left join public.track_daily_streams pt on pt.date = ov.date - 1 and pt.isrc = ov.isrc
    left join public.track_daily_stream_overrides po on po.date = ov.date - 1 and po.isrc = ov.isrc
    left join public.track_daily_streams nt on nt.date = ov.date + 1 and nt.isrc = ov.isrc
    where ov.src is not null and ov.src <> ''
  ),
  agg as (
    select date, src as source,
           count(*)::int as fixes,
           count(*) filter (where p is not null and n is not null and n > p)::int as checked,
           count(*) filter (where p is not null and n is not null and n > p and v >= p and v <= n)::int as in_range
    from scored
    group by date, src
  ),
  up as (
    insert into public.stream_source_quality_daily as t (date, source, fixes, checked, in_range)
    select date, source, fixes, checked, in_range from agg
    on conflict (date, source) do update
      set fixes = excluded.fixes, checked = excluded.checked, in_range = excluded.in_range, updated_at = now()
    returning 1
  )
  select count(*) into v_rows from up;
  return coalesce(v_rows, 0);
end;
$$;

revoke all on function public.record_stream_source_attempts(date, text, integer, integer) from public, anon, authenticated;
revoke all on function public.refresh_stream_source_quality(integer) from public, anon, authenticated;
grant execute on function public.record_stream_source_attempts(date, text, integer, integer) to service_role;
grant execute on function public.refresh_stream_source_quality(integer) to service_role;

-- Daily refresh after the morning pipeline (next-day yardsticks only exist once the next ingest has run).
select cron.schedule('streambase-source-quality', '30 7 * * *', 'select public.refresh_stream_source_quality(30)');

-- "Second look" at still-stale tracks. Created INACTIVE: the workflow input `second_look` must be on main
-- first, otherwise GitHub answers 422 and ops.check_workflow_dispatches raises an alert. Enable with
-- supabase/manual/2026-10-15_enable_stale_second_look.sql after the merge.
select cron.schedule('streambase-stale-second-look', '30 11 * * *',
  $$select ops.dispatch_workflow('rapidapi_stale_fix.yml', '{"second_look":"true"}'::jsonb)$$);
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-stale-second-look'), active := false);
