-- stream_archive_due ranked compact ROWS (isrc x month) instead of distinct months, so it returned
-- (almost) every row and ignored packed_months_keep. Rank distinct months.
create or replace function public.stream_archive_due(p_universe text)
returns table(month date)
language sql stable security definer
set search_path to 'public', 'competitor', 'ops', 'pg_temp'
as $function$
  with k as (select coalesce((select value::int from ops.stream_archive_config where key = 'packed_months_keep'), 12) as keep),
       m as (select z.month, row_number() over (order by z.month) as rn, count(*) over () as n
             from (select s.month from public.track_streams_monthly s where p_universe = 'own' group by s.month
                   union all
                   select s.month from competitor.track_streams_monthly s where p_universe = 'competitor' group by s.month) z)
  select m.month from m, k where m.rn <= m.n - k.keep order by m.month
$function$;
