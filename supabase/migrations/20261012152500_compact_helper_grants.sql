-- Phase 2 / grants parity.
-- * _latest_data_sunday / track_daily_streams_effective_range back RPCs that anon/authenticated may call and that
--   previously read only the anon-readable effective view: run them with definer rights and allow the same callers.
-- * The read-only reporting role could read public.track_daily_streams; give it the same on the history views.
create or replace function public._latest_data_sunday(p_lag interval, p_anchor date)
returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  with m as (
    select greatest((select max(b.date) from public.track_daily_streams b),
                    (select max(o.date) from public.track_daily_stream_overrides o)) as mx
  )
  select (c.d - p_lag)::date
  from m
  cross join generate_series(0, 800) as k(k)
  cross join lateral (select (least(m.mx, least(coalesce(p_anchor, m.mx), m.mx) + 2) - k.k) as d) c
  where extract(dow from (c.d - p_lag)) = 0
    and (c.d - p_lag)::date <= coalesce(p_anchor, date '9999-12-31')
    and exists (select 1 from public.track_daily_streams_effective_public s where s.date = c.d)
  order by k.k
  limit 1
$$;

create or replace function public.track_daily_streams_effective_range(p_start date, p_end date)
returns table (date date, isrc text, streams_cumulative bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return query execute
    'select e.date, e.isrc, e.streams_cumulative from public.track_daily_streams_effective_public e where e.date between $1 and $2'
    using p_start, p_end;
end
$$;

grant execute on function public._latest_data_sunday(interval, date) to anon, authenticated, service_role;
grant execute on function public.track_daily_streams_effective_range(date, date) to anon, authenticated, service_role;

grant select on public.track_daily_streams_all to claw_spotibase_readonly;
grant select on public.track_daily_streams_base_all to claw_spotibase_readonly;
