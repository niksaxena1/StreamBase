-- Phase 3 follow-up: archived months are INHERITANCE children (foreign tables with a CHECK window) of one empty
-- parent table per file kind, instead of per-month UNION ALL branches inside regenerated views.
-- Why: the planner only discards a branch whose window contradicts the query's date range when the branch is an
-- inheritance/partition member (constraint_exclusion = 'partition', the default). Plain UNION ALL branches over
-- foreign tables were never excluded, so recent-range queries still opened a foreign scan. The text->date cast in the
-- window is the IMMUTABLE ops.iso_date() wrapper (the built-in cast is only STABLE, which the planner ignores).
-- Foreign tables are text-only (the Wrappers CSV reader mishandles typed columns), so the views cast.
--
-- Attaching a month = creating its child foreign table (ops.archive_create_foreign_tables). The views are static.

-- ---------------------------------------------------------------------------------------------------------
-- Parents (empty heap tables; never written). Live tier in schema stream_archive, self-test copy in archive_selftest.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists stream_archive.own_streams (d text, isrc text, streams text);
create table if not exists stream_archive.competitor_streams (d text, isrc text, streams text);
create table if not exists stream_archive.own_overrides (id text, date text, isrc text, streams_cumulative_override text,
  note text, created_by text, created_at text, base_missing text);
create table if not exists stream_archive.competitor_overrides (id text, date text, isrc text, streams_cumulative_override text,
  note text, created_by text, created_at text, base_missing text);
create table if not exists archive_selftest.own_streams (d text, isrc text, streams text);
create table if not exists archive_selftest.competitor_streams (d text, isrc text, streams text);
create table if not exists archive_selftest.own_overrides (id text, date text, isrc text, streams_cumulative_override text,
  note text, created_by text, created_at text, base_missing text);
create table if not exists archive_selftest.competitor_overrides (id text, date text, isrc text, streams_cumulative_override text,
  note text, created_by text, created_at text, base_missing text);

alter table stream_archive.own_streams enable row level security;
alter table stream_archive.competitor_streams enable row level security;
alter table stream_archive.own_overrides enable row level security;
alter table stream_archive.competitor_overrides enable row level security;
alter table archive_selftest.own_streams enable row level security;
alter table archive_selftest.competitor_streams enable row level security;
alter table archive_selftest.own_overrides enable row level security;
alter table archive_selftest.competitor_overrides enable row level security;
revoke all on all tables in schema stream_archive from public, anon, authenticated;
revoke all on all tables in schema archive_selftest from public, anon, authenticated;
grant select on all tables in schema stream_archive to service_role;
grant select on all tables in schema archive_selftest to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Static archive views (same column lists/types as the empty placeholders they replace).
-- ---------------------------------------------------------------------------------------------------------
create or replace view public.track_daily_streams_archive as
  select ops.iso_date(a.d) as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
  from stream_archive.own_streams a;
create or replace view competitor.track_daily_streams_archive as
  select ops.iso_date(a.d) as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
  from stream_archive.competitor_streams a;
create or replace view public.track_daily_stream_overrides_archive as
  select a.id::bigint as id, ops.iso_date(a.date) as date, a.isrc as isrc,
         a.streams_cumulative_override::bigint as streams_cumulative_override,
         nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
         a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
  from stream_archive.own_overrides a;
create or replace view competitor.track_daily_stream_overrides_archive as
  select a.id::bigint as id, ops.iso_date(a.date) as date, a.isrc as isrc,
         a.streams_cumulative_override::bigint as streams_cumulative_override,
         nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
         a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
  from stream_archive.competitor_overrides a;

create or replace view archive_selftest.own_archive as
  select ops.iso_date(a.d) as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
  from archive_selftest.own_streams a;
create or replace view archive_selftest.competitor_archive as
  select ops.iso_date(a.d) as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
  from archive_selftest.competitor_streams a;
create or replace view archive_selftest.own_overrides_archive as
  select a.id::bigint as id, ops.iso_date(a.date) as date, a.isrc as isrc,
         a.streams_cumulative_override::bigint as streams_cumulative_override,
         nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
         a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
  from archive_selftest.own_overrides a;
create or replace view archive_selftest.competitor_overrides_archive as
  select a.id::bigint as id, ops.iso_date(a.date) as date, a.isrc as isrc,
         a.streams_cumulative_override::bigint as streams_cumulative_override,
         nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
         a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
  from archive_selftest.competitor_overrides a;

-- ---------------------------------------------------------------------------------------------------------
-- Child foreign tables: inherit the parent, carry the CHECK window the planner uses for exclusion.
-- ---------------------------------------------------------------------------------------------------------
create or replace function ops.archive_create_foreign_tables(p_universe text, p_month date, p_foreign_schema text, p_selftest boolean)
returns void
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  v_bucket text := (select value from ops.stream_archive_config where key = 'bucket');
  v_prefix text := (select value from ops.stream_archive_config where key = 'key_prefix');
  v_ym text := to_char(p_month, 'YYYYMM');
  v_dash text := to_char(p_month, 'YYYY-MM');
  v_path text := case when p_selftest then v_prefix || '/_selftest/' || p_universe else v_prefix || '/' || p_universe end;
  v_lo text := quote_literal(to_char(p_month, 'YYYY-MM-DD'));
  v_hi text := quote_literal(to_char((p_month + interval '1 month')::date, 'YYYY-MM-DD'));
  v_kind text;
  v_child text;
  v_parent text;
  v_datecol text;
begin
  if p_universe not in ('own', 'competitor') then
    raise exception 'unknown universe %', p_universe;
  end if;
  foreach v_kind in array array['streams', 'overrides'] loop
    v_child := p_universe || '_' || v_kind || '_' || v_ym;
    v_parent := p_universe || '_' || v_kind;
    v_datecol := case when v_kind = 'streams' then 'd' else 'date' end;
    if to_regclass(format('%I.%I', p_foreign_schema, v_child)) is null then
      execute format(
        'create foreign table %I.%I () inherits (%I.%I) server streambase_r2 options (uri %L, format %L, has_header %L, compress %L)',
        p_foreign_schema, v_child, p_foreign_schema, v_parent,
        's3://' || v_bucket || '/' || v_path || '/' || v_kind || '_' || v_dash || '.csv.gz', 'csv', 'true', 'gzip');
    elsif not exists (select 1 from pg_inherits i where i.inhrelid = format('%I.%I', p_foreign_schema, v_child)::regclass) then
      execute format('alter foreign table %I.%I inherit %I.%I', p_foreign_schema, v_child, p_foreign_schema, v_parent);
    end if;
    if not exists (select 1 from pg_constraint c where c.conrelid = format('%I.%I', p_foreign_schema, v_child)::regclass
                   and c.conname = v_child || '_window') then
      execute format(
        'alter foreign table %I.%I add constraint %I check (ops.iso_date(%I) >= date %s and ops.iso_date(%I) < date %s)',
        p_foreign_schema, v_child, v_child || '_window', v_datecol, v_lo, v_datecol, v_hi);
    end if;
  end loop;
end
$f$;
revoke all on function ops.archive_create_foreign_tables(text, date, text, boolean) from public, anon, authenticated;

-- attach/self-test no longer regenerate views (they are static).
create or replace function ops.archive_attach_month(p_universe text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, pg_temp
set statement_timeout = '280s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_hot date;
  v_in_compact boolean;
  v_res jsonb;
begin
  if p_month <> date_trunc('month', p_month)::date then
    raise exception 'month must be the first day of a month: %', p_month;
  end if;
  execute format('select %I.stream_history_hot_from()', v_schema) into v_hot;
  if p_month >= v_hot then
    raise exception 'month % is not packed yet (hot_from %)', p_month, v_hot;
  end if;
  execute format('select exists (select 1 from %I.track_streams_monthly where month = $1)', v_schema) into v_in_compact using p_month;
  if not v_in_compact and not exists (select 1 from ops.stream_archive_months where universe = p_universe and month = p_month) then
    raise exception 'month % of % is neither in compact nor archived', p_month, p_universe;
  end if;

  perform ops.archive_create_foreign_tables(p_universe, p_month, 'stream_archive', false);
  if v_in_compact then
    v_res := ops.archive_verify_month(p_universe, p_month, 'stream_archive');
    if not (v_res ->> 'ok')::boolean then
      raise exception 'archive verification failed: %', v_res::text;
    end if;
    insert into ops.stream_archive_months (universe, month, streams_rows, overrides_rows)
    values (p_universe, p_month, (v_res ->> 'streams_file_rows')::bigint, (v_res ->> 'overrides_file_rows')::bigint)
    on conflict (universe, month) do update
      set streams_rows = excluded.streams_rows, overrides_rows = excluded.overrides_rows, attached_at = now();
  else
    v_res := jsonb_build_object('ok', true, 'note', 'already archived and finalized');
  end if;
  return v_res;
end
$f$;
revoke all on function ops.archive_attach_month(text, date) from public, anon, authenticated;

create or replace function ops.archive_selftest_verify(p_universe text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, archive_selftest, pg_temp
set statement_timeout = '280s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_month date;
  v_res jsonb;
  v_t0 timestamptz;
  v_hot date;
  v_eff_a bigint; v_eff_b bigint; v_eff_n bigint; v_eff_ms numeric;
  v_plan json;
  v_recent_scan boolean; v_old_scan boolean; v_compact_scan boolean;
  v_recent_ms numeric; v_old_ms numeric; v_compact_ms numeric;
  v_view text := 'archive_selftest.' || p_universe || '_effective';
  v_live text := v_schema || '.track_daily_streams_effective';
begin
  select test_month into v_month from archive_selftest.config where universe = p_universe;
  if v_month is null then
    raise exception 'run archive_selftest_prepare first';
  end if;
  execute format('select %I.stream_history_hot_from()', v_schema) into v_hot;

  perform ops.archive_create_foreign_tables(p_universe, v_month, 'archive_selftest', true);
  v_res := ops.archive_verify_month(p_universe, v_month, 'archive_selftest');

  -- view-level proof: the test effective view (month served from the R2 copy) must equal the live effective view
  -- (month served from compact) on all 10 columns, across the archive/compact boundary.
  v_t0 := clock_timestamp();
  execute format($q$
    with a as materialized (select * from %1$s where date >= $1 and date < ($1 + interval '1 month' + interval '3 days')::date),
         b as materialized (select * from %2$s where date >= $1 and date < ($1 + interval '1 month' + interval '3 days')::date)
    select (select count(*) from (select * from a except all select * from b) x),
           (select count(*) from (select * from b except all select * from a) y),
           (select count(*) from b)$q$, v_view, v_live)
    into v_eff_a, v_eff_b, v_eff_n using v_month;
  v_eff_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  -- pruning proof 1: a recent window must not execute any foreign scan
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1', v_view) into v_plan using v_hot;
  v_recent_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_recent_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  -- pruning proof 2: a window in the compact tier (after the archived month) must not execute one either
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using (v_month + interval '1 month')::date, (v_month + interval '1 month' + interval '5 days')::date;
  v_compact_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_compact_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  -- positive control: a window inside the archived month must execute one
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_month, (v_month + 3);
  v_old_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_old_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);

  return v_res || jsonb_build_object(
    'effective_window_rows', v_eff_n, 'effective_only_in_test', v_eff_a, 'effective_only_in_live', v_eff_b,
    'effective_compare_ms', v_eff_ms,
    'recent_window_foreign_scan_executed', v_recent_scan, 'recent_window_ms', v_recent_ms,
    'compact_window_foreign_scan_executed', v_compact_scan, 'compact_window_ms', v_compact_ms,
    'archived_window_foreign_scan_executed', v_old_scan, 'archived_window_ms', v_old_ms,
    'ok', ((v_res ->> 'ok')::boolean and v_eff_a = 0 and v_eff_b = 0 and v_eff_n > 0
           and not v_recent_scan and not v_compact_scan and v_old_scan));
end
$f$;
revoke all on function ops.archive_selftest_verify(text) from public, anon, authenticated;
