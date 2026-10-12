-- Phase 2 / step 2d: the weekend-dip readers derive their date window from a CTE, so the optimiser cannot prune
-- the history-aware effective view (it built every row, ~1 s per reference). Read the window through a function
-- that is planned with the real dates.
create or replace function public.track_daily_streams_effective_range(p_start date, p_end date)
returns table (date date, isrc text, streams_cumulative bigint)
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  return query execute
    'select e.date, e.isrc, e.streams_cumulative from public.track_daily_streams_effective_public e where e.date between $1 and $2'
    using p_start, p_end;
end
$$;
revoke all on function public.track_daily_streams_effective_range(date, date) from public, anon, authenticated;
grant execute on function public.track_daily_streams_effective_range(date, date) to service_role;

do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in select unnest(array[
      'public.home_artist_weekend_dips(numeric)',
      'public.home_artist_weekend_dips(numeric,date)',
      'public.home_track_weekend_dips(numeric)',
      'public.home_track_weekend_dips(numeric,date)'
    ]) as sig
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := regexp_replace(def,
      'FROM public\.track_daily_streams_effective_public s\s+JOIN dates d ON TRUE\s+WHERE s\.date >= d\.prev_sun_run_date\s+AND s\.date <= d\.sun_run_date',
      'FROM dates d CROSS JOIN LATERAL public.track_daily_streams_effective_range(d.prev_sun_run_date, d.sun_run_date) s');
    if newdef = def then
      raise exception 'weekend range rewrite: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;
end
$$;
