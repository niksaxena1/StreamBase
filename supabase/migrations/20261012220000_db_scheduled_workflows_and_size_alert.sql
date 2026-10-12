-- Run the non-pipeline daily/weekly GitHub workflows from the database scheduler (pg_cron + pg_net
-- workflow_dispatch), like the daily pipeline. GitHub's own cron started them 6-8 hours late
-- (e.g. takedown watch set for 04:37 UTC ran at 10:59 and 12:22 UTC on 11-12 Oct 2026).
-- Their `schedule:` triggers are removed in the same commit; workflow_dispatch stays for manual runs.
--
-- Also: a weekly database-size warning above 450 MB (Free plan limit is 500 MB).
-- Failures-only email policy: alerts fire only when a dispatch fails or the size crosses the line.

create table if not exists ops.workflow_dispatches (
  id bigint generated always as identity primary key,
  workflow text not null,
  request_id bigint,
  created_at timestamptz not null default now(),
  http_status integer,
  checked_at timestamptz,
  error text
);
alter table ops.workflow_dispatches enable row level security;
revoke all on ops.workflow_dispatches from anon, authenticated;
grant all on ops.workflow_dispatches to service_role;

create or replace function ops.dispatch_workflow(p_workflow text, p_inputs jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_pat text;
  v_request_id bigint;
begin
  select decrypted_secret into v_pat from vault.decrypted_secrets where name = 'github_dispatch_pat' limit 1;
  if v_pat is null or length(trim(v_pat)) = 0 then
    insert into ops.workflow_dispatches (workflow, error, checked_at) values (p_workflow, 'github_dispatch_pat missing', now());
    perform ops.raise_alert('all', current_date, 'workflow_dispatch_failed_' || p_workflow,
      '[StreamBase] Could not start ' || p_workflow || ': GitHub token missing',
      'The vault secret github_dispatch_pat is missing, so the database scheduler cannot start ' || p_workflow || '.');
    perform ops.flush_alerts();
    return null;
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/niksaxena1/StreamBase/actions/workflows/' || p_workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_pat,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'streambase-pipeline-scheduler',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', coalesce(p_inputs, '{}'::jsonb)),
    timeout_milliseconds := 15000
  ) into v_request_id;

  insert into ops.workflow_dispatches (workflow, request_id) values (p_workflow, v_request_id);
  return v_request_id;
end;
$$;

-- GitHub answers 204 to an accepted workflow_dispatch. Anything else (or no answer within 30 min)
-- raises one alert per workflow per day.
create or replace function ops.check_workflow_dispatches()
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  d record;
  v_status integer;
  v_err text;
begin
  for d in
    select w.id, w.workflow, w.request_id, w.created_at
    from ops.workflow_dispatches w
    where w.checked_at is null and w.created_at < now() - interval '1 minute'
  loop
    select r.status_code, r.error_msg into v_status, v_err from net._http_response r where r.id = d.request_id;
    if v_status is null and v_err is null and d.created_at > now() - interval '30 minutes' then
      continue;  -- no response yet; check again next round
    end if;
    update ops.workflow_dispatches set http_status = v_status, error = v_err, checked_at = now() where id = d.id;
    if v_status is distinct from 204 then
      perform ops.raise_alert('all', current_date, 'workflow_dispatch_failed_' || d.workflow,
        '[StreamBase] Scheduled job did not start: ' || d.workflow,
        'The database scheduler asked GitHub to run ' || d.workflow || ' but got HTTP ' || coalesce(v_status::text, 'no response') ||
        coalesce(' (' || v_err || ')', '') || '. Start it by hand from GitHub Actions if needed; check the github_dispatch_pat token.');
    end if;
  end loop;
  perform ops.flush_alerts();
end;
$$;

create or replace function ops.check_db_size()
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_bytes bigint := pg_database_size(current_database());
begin
  if v_bytes > 450 * 1024 * 1024 then
    perform ops.raise_alert('all', current_date, 'db_size_warning_' || to_char(current_date, 'IYYY_IW'),
      '[StreamBase] Database is ' || pg_size_pretty(v_bytes) || ' (Free plan limit 500 MB)',
      'The StreamBase database passed the 450 MB warning line. Above 500 MB Supabase can make it read-only. '
        || 'Biggest tables: run select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class order by 2 desc; '
        || 'and see docs/COMPACT-STREAM-STORAGE.md for the levers (daily window, compact/R2 archive tiers). '
        || 'This reminder repeats at most once a week while the size stays above 450 MB.');
    perform ops.flush_alerts();
  end if;
end;
$$;

revoke all on function ops.dispatch_workflow(text, jsonb) from public, anon, authenticated;
revoke all on function ops.check_workflow_dispatches() from public, anon, authenticated;
revoke all on function ops.check_db_size() from public, anon, authenticated;

-- Same times the GitHub crons had (UTC).
select cron.schedule('streambase-takedown-watch', '37 4 * * *', $$select ops.dispatch_workflow('spotify_takedown_watch.yml')$$);
select cron.schedule('streambase-artist-tools-daily', '17 13 * * *', $$select ops.dispatch_workflow('artist_tools_daily.yml')$$);
select cron.schedule('streambase-playlist-watch', '11 15 * * *', $$select ops.dispatch_workflow('spotify_playlist_watch_daily.yml')$$);
select cron.schedule('streambase-artist-image-refresh', '0 15 * * 5', $$select ops.dispatch_workflow('spotify_artist_image_refresh.yml')$$);
select cron.schedule('streambase-workflow-dispatch-check', '*/15 * * * *', $$select ops.check_workflow_dispatches()$$);
select cron.schedule('streambase-db-size-check', '0 4 * * *', $$select ops.check_db_size()$$);
