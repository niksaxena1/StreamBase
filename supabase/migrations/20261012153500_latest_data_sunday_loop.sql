-- Phase 2 / step 2e: walk candidate days newest-first and test existence lazily (the set-based form made the
-- planner build the whole effective view for the existence check).
create or replace function public._latest_data_sunday(p_lag interval, p_anchor date)
returns date
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  mx date;
  hi date;
  d date;
  k int;
begin
  mx := greatest((select max(b.date) from public.track_daily_streams b),
                 (select max(o.date) from public.track_daily_stream_overrides o));
  if mx is null then
    return null;
  end if;
  hi := least(mx, least(coalesce(p_anchor, mx), mx) + 2);
  for k in 0..800 loop
    d := hi - k;
    if extract(dow from (d - p_lag)) = 0
       and (d - p_lag)::date <= coalesce(p_anchor, date '9999-12-31')
       and exists (select 1 from public.track_daily_streams_effective_public s where s.date = d) then
      return (d - p_lag)::date;
    end if;
  end loop;
  return null;
end
$$;
