-- Move the daily pipeline from 05:07 UTC to 12:00 UTC (16:00 Abu Dhabi), owner decision 2026-10-15.
-- At ~06:00 UTC SpotOnTrack had not re-checked many tracks yet: 113-135 own tracks needed a stale fix per
-- day (vs 0-2 when ingest ran ~12:30-18:00 UTC before 12 Oct), and competitor frozen tracks doubled
-- (~330-550 -> ~1,150-1,220). Dependent jobs shift with it.
update ops.pipeline_config set refresh_after = '12:00', deadline = '15:30' where universe = 'own';
update ops.pipeline_config set refresh_after = '12:16', deadline = '15:30' where universe = 'competitor';

select cron.alter_job((select jobid from cron.job where jobname = 'streambase-pipeline-tick'), schedule := '*/5 11-16 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-stale-second-look'), schedule := '30 17 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-source-quality'), schedule := '0 19 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-catalog-artist-monthly'), schedule := '45 14 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-artist-tools-daily'), schedule := '17 18 * * *');
