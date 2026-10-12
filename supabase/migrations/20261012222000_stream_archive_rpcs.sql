-- Phase 3 / R2 archive tier: attach + verify + self-test functions and the RPCs the monthly workflow calls.
-- Nothing here removes data. The finalize step (which removes compact rows and archived override rows from the
-- DB) is an OWNER PASTE: supabase/manual/2026-10-12_stream_archive_finalize.sql.

-- ---------------------------------------------------------------------------------------------------------
-- Foreign tables for one archived month (streams file + overrides file).
-- Files are gzip CSV: the Wrappers S3 FDW cannot read Parquet from R2 here (ranged reads fail with "service error"),
-- and its CSV reader only supports text columns, so every column is text and the views cast.
-- NULL is written as the two characters \N.
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
begin
  if p_universe not in ('own', 'competitor') then
    raise exception 'unknown universe %', p_universe;
  end if;
  execute format(
    'create foreign table if not exists %I.%I (d text, isrc text, streams text)
       server streambase_r2 options (uri %L, format %L, has_header %L, compress %L)',
    p_foreign_schema, p_universe || '_streams_' || v_ym,
    's3://' || v_bucket || '/' || v_path || '/streams_' || v_dash || '.csv.gz', 'csv', 'true', 'gzip');
  execute format(
    'create foreign table if not exists %I.%I (id text, date text, isrc text, streams_cumulative_override text,
       note text, created_by text, created_at text, base_missing text)
       server streambase_r2 options (uri %L, format %L, has_header %L, compress %L)',
    p_foreign_schema, p_universe || '_overrides_' || v_ym,
    's3://' || v_bucket || '/' || v_path || '/overrides_' || v_dash || '.csv.gz', 'csv', 'true', 'gzip');
end
$f$;
revoke all on function ops.archive_create_foreign_tables(text, date, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- (Re)generate the two archive views from a list of archived months.
-- Every branch carries its own month window so the planner excludes branches that cannot match the query's date
-- range (constraint exclusion on UNION ALL members): recent-range queries never open a foreign scan.
-- ---------------------------------------------------------------------------------------------------------
create or replace function ops.archive_rebuild_views(
  p_universe text, p_streams_view text, p_overrides_view text, p_foreign_schema text, p_months date[])
returns void
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  v_m date;
  v_streams text := '';
  v_overrides text := '';
  v_ym text;
  v_lo text;
  v_hi text;
begin
  for v_m in select x from unnest(p_months) x order by x loop
    v_ym := to_char(v_m, 'YYYYMM');
    v_lo := quote_literal(to_char(v_m, 'YYYY-MM-DD'));
    v_hi := quote_literal(to_char((v_m + interval '1 month')::date, 'YYYY-MM-DD'));
    v_streams := v_streams || case when v_streams = '' then '' else ' union all ' end ||
      format('select a.d::date as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
              from %I.%I a where a.d::date >= date %s and a.d::date < date %s',
             p_foreign_schema, p_universe || '_streams_' || v_ym, v_lo, v_hi);
    v_overrides := v_overrides || case when v_overrides = '' then '' else ' union all ' end ||
      format($q$select a.id::bigint as id, a.date::date as date, a.isrc as isrc,
                a.streams_cumulative_override::bigint as streams_cumulative_override,
                nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
                a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
              from %I.%I a where a.date::date >= date %s and a.date::date < date %s$q$,
             p_foreign_schema, p_universe || '_overrides_' || v_ym, v_lo, v_hi);
  end loop;
  if v_streams = '' then
    v_streams := 'select null::date as date, null::text as isrc, null::bigint as streams_cumulative where false';
    v_overrides := 'select null::bigint as id, null::date as date, null::text as isrc, null::bigint as streams_cumulative_override,
                    null::text as note, null::uuid as created_by, null::timestamptz as created_at, null::boolean as base_missing where false';
  end if;
  execute 'create or replace view ' || p_streams_view || ' as ' || v_streams;
  execute 'create or replace view ' || p_overrides_view || ' as ' || v_overrides;
end
$f$;
revoke all on function ops.archive_rebuild_views(text, text, text, text, date[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Verify the foreign (R2) copy of a month against the DB: row counts + EXCEPT ALL both ways, raw and overrides.
-- Each file is read ONCE (materialized CTE): the FDW has no pushdown and loads whole files.
-- ---------------------------------------------------------------------------------------------------------
create or replace function ops.archive_verify_month(p_universe text, p_month date, p_foreign_schema text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, pg_temp
set statement_timeout = '280s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_ym text := to_char(p_month, 'YYYYMM');
  v_t0 timestamptz;
  v_s_file bigint; v_s_db bigint; v_s_a bigint; v_s_b bigint;
  v_o_file bigint; v_o_db bigint; v_o_a bigint; v_o_b bigint; v_o_flag bigint;
  v_s_ms numeric; v_o_ms numeric;
begin
  v_t0 := clock_timestamp();
  execute format($q$
    with f as materialized (select a.d::date as d, a.isrc as isrc, a.streams::bigint as s from %1$I.%2$I a),
         c as materialized (select (m.month + (u.d - 1)::int) as d, m.isrc as isrc, u.v as s
                            from %3$I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
                            where m.month = $1 and u.v is not null)
    select (select count(*) from f), (select count(*) from c),
           (select count(*) from (select d, isrc, s from f except all select d, isrc, s from c) x),
           (select count(*) from (select d, isrc, s from c except all select d, isrc, s from f) y)$q$,
    p_foreign_schema, p_universe || '_streams_' || v_ym, v_schema)
    into v_s_file, v_s_db, v_s_a, v_s_b using p_month;
  v_s_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  v_t0 := clock_timestamp();
  execute format($q$
    with f as materialized (
           select a.id::bigint as id, a.date::date as d, a.isrc as isrc, a.streams_cumulative_override::bigint as v,
                  nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as cb, a.created_at::timestamptz as ca,
                  (a.base_missing = 't') as bm
           from %1$I.%2$I a),
         o as materialized (
           select id, date as d, isrc, streams_cumulative_override as v, note, created_by as cb, created_at as ca
           from %3$I.track_daily_stream_overrides where date >= $1 and date < ($1 + interval '1 month')::date),
         c as materialized (select (m.month + (u.d - 1)::int) as d, m.isrc as isrc
                            from %3$I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
                            where m.month = $1 and u.v is not null)
    select (select count(*) from f), (select count(*) from o),
           (select count(*) from (select id, d, isrc, v, note, cb, ca from f except all select id, d, isrc, v, note, cb, ca from o) x),
           (select count(*) from (select id, d, isrc, v, note, cb, ca from o except all select id, d, isrc, v, note, cb, ca from f) y),
           (select count(*) from f where f.bm is distinct from not exists (select 1 from c where c.d = f.d and c.isrc = f.isrc))$q$,
    p_foreign_schema, p_universe || '_overrides_' || v_ym, v_schema)
    into v_o_file, v_o_db, v_o_a, v_o_b, v_o_flag using p_month;
  v_o_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  return jsonb_build_object(
    'ok', (v_s_file = v_s_db and v_s_file > 0 and v_s_a = 0 and v_s_b = 0
           and v_o_file = v_o_db and v_o_a = 0 and v_o_b = 0 and v_o_flag = 0),
    'universe', p_universe, 'month', p_month,
    'streams_file_rows', v_s_file, 'streams_db_rows', v_s_db, 'streams_only_in_file', v_s_a, 'streams_only_in_db', v_s_b,
    'overrides_file_rows', v_o_file, 'overrides_db_rows', v_o_db, 'overrides_only_in_file', v_o_a, 'overrides_only_in_db', v_o_b,
    'overrides_base_flag_mismatches', v_o_flag,
    'streams_read_ms', v_s_ms, 'overrides_read_ms', v_o_ms);
end
$f$;
revoke all on function ops.archive_verify_month(text, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- LIVE: attach a month (after the workflow uploaded its files). Idempotent. Does not remove anything:
-- until finalize removes the compact rows the month is still served from compact (archive branches are limited to
-- dates < stream_compact_from()).
-- ---------------------------------------------------------------------------------------------------------
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
  v_months date[];
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

  select array_agg(month order by month) into v_months from ops.stream_archive_months where universe = p_universe;
  perform ops.archive_rebuild_views(
    p_universe, v_schema || '.track_daily_streams_archive', v_schema || '.track_daily_stream_overrides_archive',
    'stream_archive', v_months);
  return v_res;
end
$f$;
revoke all on function ops.archive_attach_month(text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- SELF-TEST (never touches live data or live views): archive a COPY of the earliest compact month under
-- <prefix>/_selftest/, serve it through archive_selftest.* (same view text as live), compare, prove pruning.
-- ---------------------------------------------------------------------------------------------------------
create or replace function ops.archive_selftest_prepare(p_universe text)
returns date
language plpgsql
security definer
set search_path = ops, public, competitor, pg_temp
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_month date;
begin
  execute format('select min(month) from %I.track_streams_monthly', v_schema) into v_month;
  if v_month is null then
    raise exception 'no compact months for %', p_universe;
  end if;
  insert into archive_selftest.config (universe, test_month) values (p_universe, v_month)
  on conflict (universe) do update set test_month = excluded.test_month;
  return v_month;
end
$f$;
revoke all on function ops.archive_selftest_prepare(text) from public, anon, authenticated;

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
  v_months date[];
  v_res jsonb;
  v_t0 timestamptz;
  v_hot date;
  v_eff_a bigint; v_eff_b bigint; v_eff_n bigint; v_eff_ms numeric;
  v_plan json;
  v_recent_scan boolean; v_old_scan boolean;
  v_recent_ms numeric; v_old_ms numeric;
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

  insert into archive_selftest.months (universe, month) values (p_universe, v_month) on conflict do nothing;
  select array_agg(month order by month) into v_months from archive_selftest.months where universe = p_universe;
  perform ops.archive_rebuild_views(
    p_universe, 'archive_selftest.' || p_universe || '_archive', 'archive_selftest.' || p_universe || '_overrides_archive',
    'archive_selftest', v_months);

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
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1', v_view)
    into v_plan using v_hot;
  v_recent_scan := jsonb_path_exists(v_plan::jsonb,
    '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_recent_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  -- positive control: a window inside the archived month must execute one
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_month, (v_month + 3);
  v_old_scan := jsonb_path_exists(v_plan::jsonb,
    '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_old_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);

  return v_res || jsonb_build_object(
    'effective_window_rows', v_eff_n, 'effective_only_in_test', v_eff_a, 'effective_only_in_live', v_eff_b,
    'effective_compare_ms', v_eff_ms,
    'recent_window_foreign_scan_executed', v_recent_scan, 'recent_window_ms', v_recent_ms,
    'archived_window_foreign_scan_executed', v_old_scan, 'archived_window_ms', v_old_ms,
    'ok', ((v_res ->> 'ok')::boolean and v_eff_a = 0 and v_eff_b = 0 and v_eff_n > 0
           and not v_recent_scan and v_old_scan));
end
$f$;
revoke all on function ops.archive_selftest_verify(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- RPCs for the workflow (service role only).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.stream_archive_due(p_universe text)
returns table (month date)
language sql stable security definer
set search_path = public, competitor, ops, pg_temp
as $f$
  with k as (select coalesce((select value::int from ops.stream_archive_config where key = 'packed_months_keep'), 12) as keep),
       m as (select z.month, row_number() over (order by z.month) as rn, count(*) over () as n
             from (select s.month from public.track_streams_monthly s where p_universe = 'own'
                   union all
                   select s.month from competitor.track_streams_monthly s where p_universe = 'competitor') z)
  select m.month from m, k where m.rn <= m.n - k.keep order by m.month
$f$;

create or replace function public.stream_month_export(p_universe text, p_month date, p_after_isrc text, p_limit integer)
returns table (isrc text, vals bigint[])
language plpgsql stable security definer
set search_path = public, competitor, pg_temp
as $f$
begin
  if p_universe = 'own' then
    return query select m.isrc, m.vals from public.track_streams_monthly m
                 where m.month = p_month and m.isrc > coalesce(p_after_isrc, '') order by m.isrc limit p_limit;
  elsif p_universe = 'competitor' then
    return query select m.isrc, m.vals from competitor.track_streams_monthly m
                 where m.month = p_month and m.isrc > coalesce(p_after_isrc, '') order by m.isrc limit p_limit;
  else
    raise exception 'unknown universe %', p_universe;
  end if;
end
$f$;

create or replace function public.stream_overrides_export(p_universe text, p_month date, p_after_id bigint, p_limit integer)
returns table (id bigint, date date, isrc text, streams_cumulative_override bigint, note text, created_by uuid, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, competitor, pg_temp
as $f$
begin
  if p_universe = 'own' then
    return query select o.id, o.date, o.isrc, o.streams_cumulative_override, o.note, o.created_by, o.created_at
                 from public.track_daily_stream_overrides o
                 where o.date >= p_month and o.date < (p_month + interval '1 month')::date and o.id > coalesce(p_after_id, 0)
                 order by o.id limit p_limit;
  elsif p_universe = 'competitor' then
    return query select o.id, o.date, o.isrc, o.streams_cumulative_override, o.note, o.created_by, o.created_at
                 from competitor.track_daily_stream_overrides o
                 where o.date >= p_month and o.date < (p_month + interval '1 month')::date and o.id > coalesce(p_after_id, 0)
                 order by o.id limit p_limit;
  else
    raise exception 'unknown universe %', p_universe;
  end if;
end
$f$;

create or replace function public.stream_archive_attach(p_universe text, p_month date)
returns jsonb
language sql security definer
set search_path = ops, public, pg_temp
as $f$ select ops.archive_attach_month(p_universe, p_month) $f$;

create or replace function public.stream_archive_selftest_prepare(p_universe text)
returns date
language sql security definer
set search_path = ops, public, pg_temp
as $f$ select ops.archive_selftest_prepare(p_universe) $f$;

create or replace function public.stream_archive_selftest_verify(p_universe text)
returns jsonb
language sql security definer
set search_path = ops, public, pg_temp
as $f$ select ops.archive_selftest_verify(p_universe) $f$;

revoke all on function public.stream_archive_due(text), public.stream_month_export(text, date, text, integer),
  public.stream_overrides_export(text, date, bigint, integer), public.stream_archive_attach(text, date),
  public.stream_archive_selftest_prepare(text), public.stream_archive_selftest_verify(text)
  from public, anon, authenticated;
grant execute on function public.stream_archive_due(text), public.stream_month_export(text, date, text, integer),
  public.stream_overrides_export(text, date, bigint, integer), public.stream_archive_attach(text, date),
  public.stream_archive_selftest_prepare(text), public.stream_archive_selftest_verify(text)
  to service_role;
