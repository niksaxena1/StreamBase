-- The workflow calls this at the end of every run so no finished one-shot cron entry is left behind.
create or replace function public.stream_archive_cleanup_jobs()
returns integer
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.jobname from cron.job c
    where c.jobname like 'streambase-archive-job-%'
      and exists (select 1 from ops.stream_archive_jobs j
                  where j.id = nullif(regexp_replace(c.jobname, '^streambase-archive-job-', ''), '')::bigint
                    and j.status in ('done', 'failed'))
  loop
    perform cron.unschedule(r.jobname);
    n := n + 1;
  end loop;
  return n;
end
$f$;
revoke all on function public.stream_archive_cleanup_jobs() from public, anon, authenticated;
grant execute on function public.stream_archive_cleanup_jobs() to service_role;
