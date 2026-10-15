-- Health page: "Today's pipeline" and "Source quality (30 days)" cards.
-- The ops schema is not exposed to the Data API, so the web app (service role, server side) reads
-- these two SECURITY DEFINER functions. Each returns one small jsonb document in a single round trip.

create or replace function public.health_pipeline_today(p_run_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ops, pg_temp
as $$
declare
  v_date date := coalesce(p_run_date, (now() at time zone 'utc')::date);
  v_start timestamptz := (coalesce(p_run_date, (now() at time zone 'utc')::date)::timestamp at time zone 'utc');
  v_tracks jsonb;
  v_affected integer := 0;
  v_unfixed integer := 0;
  v_by_source jsonb;
  v_stages jsonb;
  v_dispatches jsonb;
  v_workflows jsonb;
  v_alerts jsonb;
  v_artist_tools jsonb;
  v_rejects integer;
begin
  select w.details_json -> 'affected_tracks' into v_tracks
  from public.ingestion_warnings w
  where w.code = 'individual_tracks_stale' and w.run_date = v_date
  order by w.created_at desc
  limit 1;

  if v_tracks is not null and jsonb_typeof(v_tracks) = 'array' then
    v_affected := jsonb_array_length(v_tracks);
    select count(*) into v_unfixed
    from jsonb_array_elements(v_tracks) t
    where not exists (
      select 1 from public.track_daily_stream_overrides o
      where o.date = v_date and o.isrc = upper(t ->> 'isrc')
    );
  end if;

  select coalesce(jsonb_object_agg(s.src, jsonb_build_object('fixed', s.n, 'second_look', s.sl)), '{}'::jsonb)
  into v_by_source
  from (
    select coalesce(nullif(btrim(substring(o.note from '^stale-fix:\s*(.+?)\s+auto')), ''), 'other') as src,
           count(*) as n,
           count(*) filter (where o.note like '%second-look%') as sl
    from public.track_daily_stream_overrides o
    where o.date = v_date and o.note ~ '^stale-fix:'
    group by 1
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'universe', r.universe, 'stage', r.stage, 'status', r.status, 'detail', r.detail,
           'github_run_url', r.github_run_url, 'at', r.created_at) order by r.created_at), '[]'::jsonb)
  into v_stages
  from ops.pipeline_stage_runs r
  where r.run_date = v_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'universe', d.universe, 'stage', d.stage, 'http_status', d.http_status, 'error', d.error,
           'at', d.created_at) order by d.created_at), '[]'::jsonb)
  into v_dispatches
  from ops.pipeline_dispatches d
  where d.run_date = v_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'workflow', x.workflow, 'http_status', x.http_status, 'error', x.error,
           'at', x.created_at, 'checked_at', x.checked_at) order by x.workflow), '[]'::jsonb)
  into v_workflows
  from (
    select distinct on (w.workflow) w.workflow, w.http_status, w.error, w.created_at, w.checked_at
    from ops.workflow_dispatches w
    where w.created_at >= v_start - interval '45 days'
    order by w.workflow, w.created_at desc
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'universe', a.universe, 'kind', a.kind, 'subject', a.subject, 'at', a.created_at,
           'sent_at', a.sent_at, 'send_error', a.send_error) order by a.created_at), '[]'::jsonb)
  into v_alerts
  from ops.pipeline_alerts a
  where a.run_date = v_date or a.created_at >= v_start;

  select jsonb_build_object(
           'status', t.status, 'runner', t.runner, 'started_at', t.started_at, 'finished_at', t.finished_at,
           'added', t.added_count, 'observed', t.observed_count, 'fixed', t.fixed_count,
           'inner_status', t.details ->> 'status',
           'error', t.details ->> 'error',
           'flags', jsonb_strip_nulls(jsonb_build_object(
              'adds_incomplete', t.details -> 'adds_incomplete',
              'add_unconfirmed', t.details -> 'add_unconfirmed',
              'add_limit_reached', t.details -> 'add_limit_reached',
              'add_rate_limited', t.details -> 'add_rate_limited',
              'observation_incomplete', t.details -> 'observation_incomplete',
              'observe_rate_limited', t.details -> 'observe_rate_limited',
              'repair_incomplete', t.details -> 'repair_incomplete',
              'budget_exhausted', t.details -> 'budget_exhausted',
              'rate_limited', t.details -> 'rate_limited',
              'daily_limited', t.details -> 'daily_limited',
              'auto_fix_disabled', t.details -> 'auto_fix_disabled')))
  into v_artist_tools
  from public.artist_tools_runs t
  where t.run_date = v_date;

  select count(*) into v_rejects from public.stream_consolidation_rejects r where r.date = v_date;

  return jsonb_build_object(
    'run_date', v_date,
    'generated_at', now(),
    'stages', v_stages,
    'dispatches', v_dispatches,
    'workflows', v_workflows,
    'alerts', v_alerts,
    'stale', jsonb_build_object(
      'affected', v_affected,
      'unfixed', v_unfixed,
      'fixed', greatest(v_affected - v_unfixed, 0),
      'by_source', v_by_source,
      'rejected', v_rejects),
    'artist_tools', v_artist_tools
  );
end;
$$;

create or replace function public.health_source_quality(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with win as (
    select greatest(1, least(coalesce(p_days, 30), 90)) as days
  ),
  per_source as (
    select q.source,
           count(*) filter (where q.fixes > 0 or q.attempts > 0) as active_days,
           case when count(q.attempts) = 0 then null else sum(q.attempts)::int end as attempts,
           sum(q.fixes)::int as fixes,
           case when count(q.rejects) = 0 then null else sum(q.rejects)::int end as rejects,
           sum(q.checked)::int as checked,
           sum(q.in_range)::int as in_range,
           max(q.date) as last_date
    from public.stream_source_quality_daily q, win
    where q.date >= current_date - (win.days - 1)
    group by q.source
  )
  select jsonb_build_object(
    'days', (select days from win),
    'sources', coalesce((select jsonb_agg(to_jsonb(p) order by p.fixes desc, p.source) from per_source p), '[]'::jsonb),
    'recent_rejects', coalesce((
      select jsonb_agg(jsonb_build_object('date', r.date, 'isrc', r.isrc, 'source', r.source,
                                          'value', r.value, 'reason', r.reason) order by r.created_at desc)
      from (select * from public.stream_consolidation_rejects order by created_at desc limit 5) r), '[]'::jsonb),
    'rejects_total', (select count(*) from public.stream_consolidation_rejects r, win where r.date >= current_date - (win.days - 1))
  );
$$;

revoke all on function public.health_pipeline_today(date) from public, anon, authenticated;
revoke all on function public.health_source_quality(integer) from public, anon, authenticated;
grant execute on function public.health_pipeline_today(date) to service_role;
grant execute on function public.health_source_quality(integer) to service_role;
