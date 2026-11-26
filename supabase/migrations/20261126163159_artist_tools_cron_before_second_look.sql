-- Run the late artist.tools read at 16:17 UTC (was 18:17) so its observations exist
-- before the stale-fix second look at 17:30 UTC. Still after the 15:00 UTC cut-off.
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-artist-tools-daily'), schedule := '17 16 * * *');
