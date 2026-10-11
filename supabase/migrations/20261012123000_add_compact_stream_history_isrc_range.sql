-- Follow-up: ISRC-scoped range readers without the "p_isrcs is null or ..." escape hatch, which stops
-- the planner from using the (isrc, date) / (isrc, month) indexes when the array is not a plan-time constant.
-- Use track_daily_streams_range(start, end) for all tracks and track_daily_streams_range_isrcs(start, end, arr)
-- for a specific set. (The 3-arg track_daily_streams_range is superseded; keep until the owner removes it.)
create or replace function public.track_daily_streams_range_isrcs(p_start date, p_end date, p_isrcs text[])
returns table (date date, isrc text, streams_cumulative bigint)
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative
  from public.track_daily_streams t
  where t.isrc = any (p_isrcs)
    and t.date >= p_start
    and t.date >= public.stream_history_hot_from()
    and t.date <= p_end
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v
  from public.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.isrc = any (p_isrcs)
    and m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < public.stream_history_hot_from()
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

create or replace function competitor.track_daily_streams_range_isrcs(p_start date, p_end date, p_isrcs text[])
returns table (date date, isrc text, streams_cumulative bigint, est_revenue_total numeric)
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total
  from competitor.track_daily_streams t
  where t.isrc = any (p_isrcs)
    and t.date >= p_start
    and t.date >= competitor.stream_history_hot_from()
    and t.date <= p_end
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v, competitor.stream_est_revenue(u.v)
  from competitor.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.isrc = any (p_isrcs)
    and m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < competitor.stream_history_hot_from()
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

grant execute on function public.track_daily_streams_range_isrcs(date, date, text[]) to service_role;
grant execute on function competitor.track_daily_streams_range_isrcs(date, date, text[]) to service_role;
