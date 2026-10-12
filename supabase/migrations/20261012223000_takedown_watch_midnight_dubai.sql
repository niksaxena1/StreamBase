-- Owner request 2026-10-12: run the Spotify takedown check at 00:00 Dubai time (20:00 UTC).
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-takedown-watch'), schedule := '0 20 * * *');
