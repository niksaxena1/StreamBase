-- Playlist Watch follower snapshot at 18:00 Abu Dhabi (14:00 UTC), owner request 2026-10-28 (was 15:11 UTC).
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-playlist-watch'), schedule := '0 14 * * *');
