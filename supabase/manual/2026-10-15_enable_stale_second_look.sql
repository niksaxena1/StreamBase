-- OWNER PASTE, after the stale second-look branch is merged to main (the workflow must know the
-- `second_look` input, otherwise GitHub answers 422 and a dispatch alert is raised).
-- Enables the 11:30 UTC (15:30 Dubai) database dispatch of the stale-track second look.
select cron.alter_job((select jobid from cron.job where jobname = 'streambase-stale-second-look'), active := true);

-- Check:
select jobname, schedule, active from cron.job
where jobname in ('streambase-stale-second-look', 'streambase-source-quality');

-- Disable again:
-- select cron.alter_job((select jobid from cron.job where jobname = 'streambase-stale-second-look'), active := false);
