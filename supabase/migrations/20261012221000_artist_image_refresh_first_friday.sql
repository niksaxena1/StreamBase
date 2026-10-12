-- The image-refresh workflow only gated *GitHub-scheduled* runs to the first Friday of the month; dispatched
-- runs bypass that gate, so the database schedule applies it instead (applied 2026-10-12 via cron.alter_job).
select cron.alter_job(
  (select jobid from cron.job where jobname = 'streambase-artist-image-refresh'),
  command := $c$select ops.dispatch_workflow('spotify_artist_image_refresh.yml') where extract(day from (now() at time zone 'utc')) <= 7$c$
);
