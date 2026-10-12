-- Phase 3 follow-up.
-- 1) text->date casts are STABLE, so the planner ignored the per-month windows in the archive view branches
--    (self-contradiction detection skips mutable expressions) and recent-range queries still opened foreign scans.
--    ops.iso_date() is an IMMUTABLE, never-inlined wrapper (ISO yyyy-mm-dd parses identically under every DateStyle),
--    so branches whose window cannot match the query's date range are excluded at plan time.
-- 2) Heavy archive steps (FDW reads of whole files) take longer than the 8 s PostgREST statement timeout, so they run
--    as one-shot pg_cron jobs: the workflow enqueues a job, the job runs at the next minute boundary and unschedules
--    itself, the workflow polls the result.
create or replace function ops.iso_date(p text)
returns date
language plpgsql immutable parallel safe
set search_path = pg_catalog
as $f$
begin
  return p::date;
end
$f$;
grant execute on function ops.iso_date(text) to postgres, service_role, authenticated, anon;

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
      format('select ops.iso_date(a.d) as date, a.isrc as isrc, a.streams::bigint as streams_cumulative
              from %I.%I a where ops.iso_date(a.d) >= date %s and ops.iso_date(a.d) < date %s',
             p_foreign_schema, p_universe || '_streams_' || v_ym, v_lo, v_hi);
    v_overrides := v_overrides || case when v_overrides = '' then '' else ' union all ' end ||
      format($q$select a.id::bigint as id, ops.iso_date(a.date) as date, a.isrc as isrc,
                a.streams_cumulative_override::bigint as streams_cumulative_override,
                nullif(a.note, '\N') as note, nullif(a.created_by, '\N')::uuid as created_by,
                a.created_at::timestamptz as created_at, (a.base_missing = 't') as base_missing
              from %I.%I a where ops.iso_date(a.date) >= date %s and ops.iso_date(a.date) < date %s$q$,
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
-- Job queue for the heavy steps.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists ops.stream_archive_jobs (
  id bigserial primary key,
  kind text not null check (kind in ('selftest_verify', 'attach', 'finalize')),
  universe text not null check (universe in ('own', 'competitor')),
  month date,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
alter table ops.stream_archive_jobs enable row level security;
revoke all on ops.stream_archive_jobs from public, anon, authenticated;
grant all on ops.stream_archive_jobs to service_role;
grant usage on sequence ops.stream_archive_jobs_id_seq to service_role;

create or replace function ops.archive_run_job(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ops, public, pg_temp
set statement_timeout = '280s'
as $f$
declare
  j ops.stream_archive_jobs;
  v_res jsonb;
begin
  -- one-shot: unschedule first so a slow run is never started twice
  perform cron.unschedule('streambase-archive-job-' || p_id);
  select * into j from ops.stream_archive_jobs where id = p_id and status = 'pending' for update skip locked;
  if not found then
    return;
  end if;
  update ops.stream_archive_jobs set status = 'running', started_at = now() where id = p_id;
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
    update ops.stream_archive_jobs set status = 'done', result = v_res, finished_at = now() where id = p_id;
  exception when others then
    update ops.stream_archive_jobs set status = 'failed', error = sqlerrm, finished_at = now() where id = p_id;
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
begin
  insert into ops.stream_archive_jobs (kind, universe, month) values (p_kind, p_universe, p_month) returning id into v_id;
  perform cron.schedule('streambase-archive-job-' || v_id, '* * * * *', 'select ops.archive_run_job(' || v_id || ')');
  return v_id;
end
$f$;

create or replace function public.stream_archive_job_status(p_id bigint)
returns jsonb
language sql stable security definer
set search_path = ops, public, pg_temp
as $f$
  select to_jsonb(j) - 'id' from ops.stream_archive_jobs j where j.id = p_id
$f$;

revoke all on function public.stream_archive_enqueue(text, text, date), public.stream_archive_job_status(bigint) from public, anon, authenticated;
grant execute on function public.stream_archive_enqueue(text, text, date), public.stream_archive_job_status(bigint) to service_role;
