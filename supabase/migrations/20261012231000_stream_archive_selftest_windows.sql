-- Phase 3 follow-up: measured R2 behaviour from Supabase is bimodal (a whole-month file read is ~1-2 s, but a call can
-- take 10-40 s when a new connection stalls), and every query that touches an archived month re-reads the file (no
-- pushdown, no cache). So:
--  * the self-test's view-level comparison now covers (A) the archive/compact boundary (last 4 days of the archived
--    month + 3 days after) and (B) a 3-day window around the first override of that month, instead of the whole month
--    (whole-month equality is already proven row by row by archive_verify_month). That keeps the self-test to a handful
--    of file reads;
--  * one-shot jobs may run up to 15 minutes (statement_timeout) before they are considered failed.
create or replace function ops.archive_selftest_verify(p_universe text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, archive_selftest, pg_temp
set statement_timeout = '850s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_month date;
  v_month_end date;
  v_ov_date date;
  v_res jsonb;
  v_t0 timestamptz;
  v_hot date;
  v_a1 bigint; v_b1 bigint; v_n1 bigint;
  v_a2 bigint := 0; v_b2 bigint := 0; v_n2 bigint := 0;
  v_eff_ms numeric;
  v_plan json;
  v_recent_scan boolean; v_old_scan boolean; v_compact_scan boolean;
  v_recent_ms numeric; v_old_ms numeric; v_compact_ms numeric;
  v_view text := 'archive_selftest.' || p_universe || '_effective';
  v_live text := v_schema || '.track_daily_streams_effective';
  v_cmp text := $q$
    with a as materialized (select * from %1$s where date >= $1 and date < $2),
         b as materialized (select * from %2$s where date >= $1 and date < $2)
    select (select count(*) from (select * from a except all select * from b) x),
           (select count(*) from (select * from b except all select * from a) y),
           (select count(*) from b)$q$;
begin
  select test_month into v_month from archive_selftest.config where universe = p_universe;
  if v_month is null then
    raise exception 'run archive_selftest_prepare first';
  end if;
  v_month_end := (v_month + interval '1 month')::date;
  execute format('select %I.stream_history_hot_from()', v_schema) into v_hot;

  perform ops.archive_create_foreign_tables(p_universe, v_month, 'archive_selftest', true);
  v_res := ops.archive_verify_month(p_universe, v_month, 'archive_selftest');

  v_t0 := clock_timestamp();
  -- (A) archive/compact boundary
  execute format(v_cmp, v_view, v_live) into v_a1, v_b1, v_n1 using v_month_end - 4, v_month_end + 3;
  -- (B) around the first override of the month (override metadata / precedence path)
  execute format('select min(date) from %I.track_daily_stream_overrides where date >= $1 and date < $2', v_schema)
    into v_ov_date using v_month, v_month_end;
  if v_ov_date is not null then
    execute format(v_cmp, v_view, v_live) into v_a2, v_b2, v_n2 using v_ov_date, v_ov_date + 3;
  end if;
  v_eff_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  -- pruning proofs (5-day windows): daily tier and compact tier must not execute a foreign scan; archived month must.
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_hot, (v_hot + 5);
  v_recent_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_recent_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_month_end, (v_month_end + 5);
  v_compact_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_compact_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_month, (v_month + 5);
  v_old_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_old_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);

  return v_res || jsonb_build_object(
    'effective_window_rows', v_n1 + v_n2, 'effective_only_in_test', v_a1 + v_a2, 'effective_only_in_live', v_b1 + v_b2,
    'override_window_checked', v_ov_date is not null, 'effective_compare_ms', v_eff_ms,
    'recent_window_foreign_scan_executed', v_recent_scan, 'recent_window_ms', v_recent_ms,
    'compact_window_foreign_scan_executed', v_compact_scan, 'compact_window_ms', v_compact_ms,
    'archived_window_foreign_scan_executed', v_old_scan, 'archived_window_ms', v_old_ms,
    'ok', ((v_res ->> 'ok')::boolean and (v_a1 + v_a2) = 0 and (v_b1 + v_b2) = 0 and v_n1 > 0
           and not v_recent_scan and not v_compact_scan and v_old_scan));
end
$f$;
revoke all on function ops.archive_selftest_verify(text) from public, anon, authenticated;

create or replace function public.stream_archive_enqueue(p_kind text, p_universe text, p_month date)
returns bigint
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  v_id bigint;
  v_when timestamp := date_trunc('minute', now() at time zone 'utc') + interval '2 minutes';
  r record;
begin
  for r in
    select c.jobname from cron.job c
    where c.jobname like 'streambase-archive-job-%'
      and exists (select 1 from ops.stream_archive_jobs j
                  where j.id = nullif(regexp_replace(c.jobname, '^streambase-archive-job-', ''), '')::bigint
                    and j.status in ('done', 'failed'))
  loop
    perform cron.unschedule(r.jobname);
  end loop;

  insert into ops.stream_archive_jobs (kind, universe, month) values (p_kind, p_universe, p_month) returning id into v_id;
  perform cron.schedule(
    'streambase-archive-job-' || v_id,
    to_char(v_when, 'FMMI FMHH24 FMDD FMMM') || ' *',
    'set statement_timeout = ''900s''; select ops.archive_run_job(' || v_id || ')');
  return v_id;
end
$f$;
revoke all on function public.stream_archive_enqueue(text, text, date) from public, anon, authenticated;
grant execute on function public.stream_archive_enqueue(text, text, date) to service_role;

alter function ops.archive_verify_month(text, date, text) set statement_timeout = '850s';
alter function ops.archive_attach_month(text, date) set statement_timeout = '850s';
