-- Territory availability scan: the workflow file was renamed
-- spotify_market_availability_weekly.yml -> spotify_market_availability_daily.yml
-- (it has run daily since 20261107090000). Point the pg_cron job at the new file name.
-- Same schedule as before (daily 21:00 UTC = 01:00 Dubai). Idempotent: drop any
-- existing job of the same name first. Apply only after the renamed workflow is on main,
-- otherwise the dispatch would 404 (ops.check_workflow_dispatches emails that).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'streambase-market-availability';
  PERFORM cron.schedule(
    'streambase-market-availability',
    '0 21 * * *',
    $c$select ops.dispatch_workflow('spotify_market_availability_daily.yml')$c$
  );
END
$$;
