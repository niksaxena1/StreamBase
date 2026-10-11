-- DB-orchestrated daily SpotOnTrack pipeline (own catalog + competitors).
--
-- Why: GitHub schedules on this repo start 5-7 hours late (Oct 2026: 05:07 UTC
-- refresh cron started 11:06-12:12 UTC), so data landed 14:30-18:00 UTC.
-- pg_cron here starts each universe on time via repository_dispatch, waits for
-- SpotOnTrack to process the refresh without holding a GitHub runner, retries
-- once, and raises an email alert (via the pipeline-alert Edge Function) when a
-- day is not ingested by its deadline or GitHub rejects a dispatch.
--
-- Own catalog and competitor stay separate: each has its own config row,
-- repository_dispatch event type (own-pipeline / competitor-pipeline), GitHub
-- workflow, and ingestion_runs table (public vs competitor). The ops schema
-- holds orchestration metadata only (no analytics data) and is not exposed to
-- the Data API; workflows and the Edge Function use service_role-only RPCs.
--
-- Credentials (set by the owner, never committed):
--   vault secret 'github_dispatch_pat'  fine-grained PAT, Contents+Actions RW
--   Edge Function secret NOTIFY_SMTP_PASSWORD  Gmail app password

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to service_role;

-- Per-universe schedule. Times are UTC.
create table if not exists ops.pipeline_config (
  universe text primary key check (universe in ('own', 'competitor')),
  enabled boolean not null default true,
  refresh_after time not null,
  sync_wait_minutes integer not null default 10 check (sync_wait_minutes between 0 and 180),
  deadline time not null,
  max_refresh_attempts integer not null default 2 check (max_refresh_attempts between 1 and 5),
  max_sync_attempts integer not null default 2 check (max_sync_attempts between 1 and 5)
);

-- The two universes share one SpotOnTrack login; keep the historical 16 min stagger.
-- Disabled until the own-pipeline / competitor-pipeline workflows are on main;
-- enable with: update ops.pipeline_config set enabled = true;
insert into ops.pipeline_config (universe, enabled, refresh_after, deadline)
values ('own', false, '05:07', '08:30'), ('competitor', false, '05:23', '08:30')
on conflict (universe) do nothing;

-- Stage progress reported by the GitHub workflows.
create table if not exists ops.pipeline_stage_runs (
  id bigserial primary key,
  universe text not null check (universe in ('own', 'competitor')),
  run_date date not null,
  stage text not null check (stage in ('refresh', 'sync_export')),
  status text not null check (status in ('started', 'success', 'failure', 'skipped')),
  github_run_url text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_stage_runs_lookup_idx
  on ops.pipeline_stage_runs (universe, run_date, stage, created_at desc);

-- repository_dispatch requests sent by pg_net, with GitHub's HTTP answer.
create table if not exists ops.pipeline_dispatches (
  id bigserial primary key,
  universe text not null check (universe in ('own', 'competitor')),
  run_date date not null,
  stage text not null check (stage in ('refresh', 'sync_export')),
  request_id bigint,
  http_status integer,
  error text,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index if not exists pipeline_dispatches_lookup_idx
  on ops.pipeline_dispatches (universe, run_date, stage, created_at desc);

-- Alert outbox; one row per (universe, run_date, kind) so each problem mails once.
create table if not exists ops.pipeline_alerts (
  id bigserial primary key,
  universe text not null,
  run_date date not null,
  kind text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  send_attempts integer not null default 0,
  send_error text,
  unique (universe, run_date, kind)
);

alter table ops.pipeline_config enable row level security;
alter table ops.pipeline_stage_runs enable row level security;
alter table ops.pipeline_dispatches enable row level security;
alter table ops.pipeline_alerts enable row level security;
revoke all on all tables in schema ops from public, anon, authenticated;
grant all on all tables in schema ops to service_role;
grant usage on all sequences in schema ops to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (ops schema; not callable over the Data API).

create or replace function ops.raise_alert(
  p_universe text, p_run_date date, p_kind text, p_subject text, p_body text
) returns void
language sql
security definer
set search_path = ops, pg_temp
as $$
  insert into ops.pipeline_alerts (universe, run_date, kind, subject, body)
  values (p_universe, p_run_date, p_kind, p_subject, p_body)
  on conflict (universe, run_date, kind) do nothing;
$$;

create or replace function ops.dispatch_github(p_universe text, p_run_date date, p_stage text)
returns bigint
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_pat text;
  v_request_id bigint;
begin
  select decrypted_secret into v_pat
  from vault.decrypted_secrets
  where name = 'github_dispatch_pat'
  limit 1;

  if v_pat is null or length(trim(v_pat)) = 0 then
    perform ops.raise_alert(
      'all', p_run_date, 'missing_github_token',
      '[StreamBase] Pipeline cannot start: GitHub token missing',
      'The database scheduler has no vault secret named github_dispatch_pat, so it cannot start the '
        || 'daily pipeline. Create a fine-grained GitHub token (Contents + Actions read/write on '
        || 'niksaxena1/StreamBase) and run in the Supabase SQL editor:' || chr(10)
        || '  select vault.create_secret(''<token>'', ''github_dispatch_pat'', ''StreamBase pipeline dispatch'');'
        || chr(10) || 'GitHub fallback schedules will still try later in the day.'
    );
    return null;
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/niksaxena1/StreamBase/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_pat,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'streambase-pipeline-scheduler',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'event_type', p_universe || '-pipeline',
      'client_payload', jsonb_build_object(
        'stage', p_stage, 'run_date', p_run_date::text, 'source', 'db-scheduler'
      )
    ),
    timeout_milliseconds := 15000
  ) into v_request_id;

  insert into ops.pipeline_dispatches (universe, run_date, stage, request_id)
  values (p_universe, p_run_date, p_stage, v_request_id);

  return v_request_id;
end;
$$;

create or replace function ops.flush_alerts()
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
begin
  -- The Edge Function takes no input: it reads pending rows itself with its own
  -- service-role key, so calling it can only send alerts already queued here.
  if exists (select 1 from ops.pipeline_alerts where sent_at is null and send_attempts < 5) then
    perform net.http_post(
      url := 'https://ucbbxzotbhkehjgbvdfm.supabase.co/functions/v1/pipeline-alert',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler tick (pg_cron, every 5 minutes during the morning window).

create or replace function ops.pipeline_tick()
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_time time := (now() at time zone 'utc')::time;
  v_today date := (now() at time zone 'utc')::date;
  c ops.pipeline_config%rowtype;
  d record;
  v_ingested boolean;
  v_refresh_ok_at timestamptz;
  v_refresh_dispatches integer;
  v_last_refresh_dispatch timestamptz;
  v_refresh_failed boolean;
  v_sync_dispatches integer;
  v_last_sync_dispatch timestamptz;
  v_last_sync_status text;
  v_last_sync_status_at timestamptz;
  v_summary text;
begin
  -- 1. Record GitHub's answers to earlier dispatches; alert on anything but 204.
  for d in
    select pd.id, pd.universe, pd.run_date, pd.stage, r.status_code, r.timed_out, r.error_msg
    from ops.pipeline_dispatches pd
    join net._http_response r on r.id = pd.request_id
    where pd.checked_at is null
  loop
    update ops.pipeline_dispatches
    set http_status = d.status_code,
        error = coalesce(d.error_msg, case when d.timed_out then 'timed out' end),
        checked_at = v_now
    where id = d.id;

    if d.status_code is distinct from 204 then
      perform ops.raise_alert(
        d.universe, d.run_date, 'dispatch_failed_' || d.stage,
        format('[StreamBase] GitHub rejected the %s pipeline start (HTTP %s)', d.universe, coalesce(d.status_code::text, 'none')),
        format('The database scheduler asked GitHub to start the %s %s stage for %s and got HTTP %s%s.',
               d.universe, d.stage, d.run_date, coalesce(d.status_code::text, 'none'),
               coalesce(' (' || coalesce(d.error_msg, case when d.timed_out then 'timed out' end) || ')', ''))
          || chr(10) || '401/403/404 usually means the github_dispatch_pat vault secret expired or lacks '
          || 'Contents + Actions read/write on niksaxena1/StreamBase. Replace it with vault.update_secret.'
      );
    end if;
  end loop;

  -- Responses pg_net never produced (pruned or lost) after 30 minutes.
  update ops.pipeline_dispatches
  set checked_at = v_now, error = 'no response recorded'
  where checked_at is null and created_at < v_now - interval '30 minutes';

  -- 2. Drive each universe for today.
  for c in select * from ops.pipeline_config where enabled order by universe loop
    v_sync_dispatches := null;
    v_summary := null;
    if c.universe = 'own' then
      select exists (select 1 from public.ingestion_runs where run_date = v_today and status = 'success') into v_ingested;
    else
      select exists (select 1 from competitor.ingestion_runs where run_date = v_today and status = 'success') into v_ingested;
    end if;

    continue when v_ingested;
    continue when v_time < c.refresh_after;

    select max(created_at) into v_refresh_ok_at
    from ops.pipeline_stage_runs
    where universe = c.universe and run_date = v_today and stage = 'refresh' and status in ('success', 'skipped');

    select count(*), max(created_at) into v_refresh_dispatches, v_last_refresh_dispatch
    from ops.pipeline_dispatches
    where universe = c.universe and run_date = v_today and stage = 'refresh';

    if v_refresh_ok_at is null then
      select exists (
        select 1 from ops.pipeline_stage_runs
        where universe = c.universe and run_date = v_today and stage = 'refresh' and status = 'failure'
          and created_at > coalesce(v_last_refresh_dispatch, '-infinity'::timestamptz)
      ) into v_refresh_failed;

      if v_refresh_dispatches = 0
         or (v_refresh_dispatches < c.max_refresh_attempts
             and (v_refresh_failed or v_last_refresh_dispatch < v_now - interval '45 minutes')) then
        perform ops.dispatch_github(c.universe, v_today, 'refresh');
      end if;
    elsif v_now >= v_refresh_ok_at + make_interval(mins => c.sync_wait_minutes) then
      select count(*), max(created_at) into v_sync_dispatches, v_last_sync_dispatch
      from ops.pipeline_dispatches
      where universe = c.universe and run_date = v_today and stage = 'sync_export';

      select status, created_at into v_last_sync_status, v_last_sync_status_at
      from ops.pipeline_stage_runs
      where universe = c.universe and run_date = v_today and stage = 'sync_export'
      order by created_at desc
      limit 1;

      if v_sync_dispatches = 0 then
        perform ops.dispatch_github(c.universe, v_today, 'sync_export');
      elsif v_sync_dispatches < c.max_sync_attempts and (
              (v_last_sync_status = 'failure' and v_last_sync_status_at > v_last_sync_dispatch
               and v_now > v_last_sync_status_at + interval '15 minutes')
              or (v_last_sync_status_at is null or v_last_sync_status_at < v_last_sync_dispatch)
                 and v_last_sync_dispatch < v_now - interval '60 minutes'
              -- Killed runner / job timeout: 'started' with no final row.
              or (v_last_sync_status = 'started' and v_last_sync_status_at < v_now - interval '150 minutes')
            ) then
        perform ops.dispatch_github(c.universe, v_today, 'sync_export');
      end if;
    end if;

    -- 3. Deadline: today's data still missing.
    if v_time >= c.deadline then
      select string_agg(format('  %s %s %s %s', to_char(created_at at time zone 'utc', 'HH24:MI'), stage, status,
                               coalesce(github_run_url, '')), chr(10) order by created_at)
      into v_summary
      from ops.pipeline_stage_runs
      where universe = c.universe and run_date = v_today;

      perform ops.raise_alert(
        c.universe, v_today, 'not_ingested',
        format('[StreamBase] %s data for %s not ingested by %s UTC',
               case c.universe when 'own' then 'Own-catalog' else 'Competitor' end, v_today, to_char(c.deadline, 'HH24:MI')),
        format('No successful %s ingestion for %s yet.', c.universe, v_today) || chr(10) || chr(10)
          || 'Stages reported today (UTC):' || chr(10) || coalesce(v_summary, '  none — the workflow never started')
          || chr(10) || chr(10)
          || format('Start signals sent today: %s refresh, %s sync/export.',
                    v_refresh_dispatches, coalesce(v_sync_dispatches, 0)) || chr(10)
          || 'Actions: https://github.com/niksaxena1/StreamBase/actions'
      );
    end if;
  end loop;

  perform ops.flush_alerts();
end;
$$;

revoke all on all functions in schema ops from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data API entry points (service_role only).

create or replace function public.pipeline_record_stage(
  p_universe text, p_run_date date, p_stage text, p_status text,
  p_github_run_url text default null, p_detail text default null
) returns void
language sql
security definer
set search_path = ops, pg_temp
as $$
  insert into ops.pipeline_stage_runs (universe, run_date, stage, status, github_run_url, detail)
  values (p_universe, p_run_date, p_stage, p_status, p_github_run_url, left(p_detail, 2000));
$$;

create or replace function public.pipeline_claim_alerts()
returns table (id bigint, subject text, body text)
language sql
security definer
set search_path = ops, pg_temp
as $$
  update ops.pipeline_alerts a
  set send_attempts = a.send_attempts + 1
  where a.sent_at is null and a.send_attempts < 5
  returning a.id, a.subject, a.body;
$$;

create or replace function public.pipeline_mark_alert(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ops, pg_temp
as $$
  update ops.pipeline_alerts
  set sent_at = case when p_error is null then now() else sent_at end,
      send_error = p_error
  where id = p_id;
$$;

revoke all on function public.pipeline_record_stage(text, date, text, text, text, text) from public, anon, authenticated;
revoke all on function public.pipeline_claim_alerts() from public, anon, authenticated;
revoke all on function public.pipeline_mark_alert(bigint, text) from public, anon, authenticated;
grant execute on function public.pipeline_record_stage(text, date, text, text, text, text) to service_role;
grant execute on function public.pipeline_claim_alerts() to service_role;
grant execute on function public.pipeline_mark_alert(bigint, text) to service_role;

-- Every 5 minutes from 04:00 to 12:55 UTC (08:00-16:55 Dubai).
select cron.schedule('streambase-pipeline-tick', '*/5 4-12 * * *', 'select ops.pipeline_tick()');
