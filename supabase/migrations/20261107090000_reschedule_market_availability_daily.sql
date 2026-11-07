-- Territory availability scan: weekly -> daily.
--
-- The scan now skips tracks the takedown watch marks unavailable, so a daily
-- run stays within the Spotify request budget. Same dispatch target as before
-- (the workflow file keeps its name; pg_cron references it). Daily 21:00 UTC =
-- 01:00 Dubai. Idempotent: drop any existing job of the same name first.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'streambase-market-availability';
  PERFORM cron.schedule(
    'streambase-market-availability',
    '0 21 * * *',
    $c$select ops.dispatch_workflow('spotify_market_availability_weekly.yml')$c$
  );
END
$$;
