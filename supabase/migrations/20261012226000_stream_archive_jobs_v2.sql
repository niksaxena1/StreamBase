-- Phase 3 follow-up: one-shot jobs that cannot loop, and a lighter self-test.
--
-- * The job used to unschedule itself inside its own transaction; when the run failed (statement timeout cancels the
--   whole transaction, and 57014 is not catchable) the unschedule rolled back and the job re-ran every minute.
--   Now: the job is scheduled for ONE calendar minute (day/month fixed, i.e. it would only recur next year), the
--   command raises the statement timeout first, the runner only acts on rows that are still 'pending' (so a repeat is a
--   no-op), and each enqueue removes the cron entries of finished jobs.
-- * The self-test compares the effective views over the archived month + 3 days (not a month + 3 days) and samples
--   5-day windows for the pruning proofs, so it finishes well inside the job time limit.
create or replace function ops.archive_run_job(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  j ops.stream_archive_jobs;
  v_res jsonb;
begin
  select * into j from ops.stream_archive_jobs where id = p_id and status = 'pending' for update skip locked;
  if not found then
    return;
  end if;
  update ops.stream_archive_jobs set status = 'running', started_at = clock_timestamp() where id = p_id;
  begin
    if j.kind = 'selftest_verify' then
      v_res := ops.archive_selftest_verify(j.universe);
    elsif j.kind = 'attach' then
      v_res := ops.archive_attach_month(j.universe, j.month);
    elsif j.kind = 'finalize' then
      if to_regprocedure('ops.archive_finalize_month(text,date)') is null then
        raise exception 'finalize not installed: run supabase/manual/2026-10-12_stream_archive_finalize.sql';
      end if;
      execute 'select ops.archive_finalize_month($1, $2)' into v_res using j.universe, j.month;
    end if;
    update ops.stream_archive_jobs set status = 'done', result = v_res, finished_at = clock_timestamp() where id = p_id;
  exception when others then
    update ops.stream_archive_jobs set status = 'failed', error = sqlerrm, finished_at = clock_timestamp() where id = p_id;
  end;
end
$f$;
revoke all on function ops.archive_run_job(bigint) from public, anon, authenticated;

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
  -- housekeeping: remove cron entries of finished jobs
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
    'set statement_timeout = ''280s''; select ops.archive_run_job(' || v_id || ')');
  return v_id;
end
$f$;
revoke all on function public.stream_archive_enqueue(text, text, date) from public, anon, authenticated;
grant execute on function public.stream_archive_enqueue(text, text, date) to service_role;

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

  -- view-level proof: archived month served from the R2 copy == the live view (served from compact), 10 columns,
  -- across the archive/compact boundary (month + 3 days).
  v_t0 := clock_timestamp();
  execute format($q$
    with a as materialized (select * from %1$s where date >= $1 and date < ($1 + interval '1 month' + interval '3 days')::date),
         b as materialized (select * from %2$s where date >= $1 and date < ($1 + interval '1 month' + interval '3 days')::date)
    select (select count(*) from (select * from a except all select * from b) x),
           (select count(*) from (select * from b except all select * from a) y),
           (select count(*) from b)$q$, v_view, v_live)
    into v_eff_a, v_eff_b, v_eff_n using v_month;
  v_eff_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  -- pruning proofs (5-day windows): daily tier and compact tier must not execute a foreign scan; archived month must.
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_hot, (v_hot + 5);
  v_recent_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_recent_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using (v_month + interval '1 month')::date, (v_month + interval '1 month' + interval '5 days')::date;
  v_compact_scan := jsonb_path_exists(v_plan::jsonb, '$.** ? (@."Node Type" == "Foreign Scan" && @."Actual Loops" > 0)');
  v_compact_ms := round(((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric);
  execute format('explain (analyze, format json) select count(*) from %s where date >= $1 and date < $2', v_view)
    into v_plan using v_month, (v_month + 5);
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
