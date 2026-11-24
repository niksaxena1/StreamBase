-- 23 Nov 2026: SpotOnTrack served empty pages; both sync attempts failed and the tick window
-- (11-16 UTC) closed before a third try, so the day needed a manual start.
update ops.pipeline_config set max_sync_attempts = 3, deadline = '17:30'
where universe in ('own', 'competitor');

select cron.alter_job(jobid, schedule := '*/5 11-20 * * *')
from cron.job where jobname = 'streambase-pipeline-tick';

-- Applied separately on 24 Nov 2026 (not part of this migration's recorded SQL): the Beatport
-- trigger was paused with cron.alter_job(jobid, active := false) for 'streambase-beatport-chart'
-- and `gh workflow disable`, because Beatport has refused the daily request (HTTP 403) since 19 Nov.
