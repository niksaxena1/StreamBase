-- Follow-up to 20261012120000: allow parallel plans (functions were implicitly PARALLEL UNSAFE)
-- and give the planner a plain static date qual so partition pruning works at plan time.
create or replace function public.stream_history_hot_from()
returns date language sql stable parallel safe
as $$
  select coalesce((select max(m.month) from public.track_streams_monthly m) + interval '1 month', date '0001-01-01')::date
$$;

create or replace function competitor.stream_history_hot_from()
returns date language sql stable parallel safe
as $$
  select coalesce((select max(m.month) from competitor.track_streams_monthly m) + interval '1 month', date '0001-01-01')::date
$$;

create or replace function public.track_daily_streams_range(p_start date, p_end date, p_isrcs text[] default null)
returns table (date date, isrc text, streams_cumulative bigint)
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative
  from public.track_daily_streams t
  where t.date >= p_start
    and t.date >= public.stream_history_hot_from()
    and t.date <= p_end
    and (p_isrcs is null or t.isrc = any (p_isrcs))
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v
  from public.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < public.stream_history_hot_from()
    and (p_isrcs is null or m.isrc = any (p_isrcs))
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

create or replace function competitor.track_daily_streams_range(p_start date, p_end date, p_isrcs text[] default null)
returns table (date date, isrc text, streams_cumulative bigint, est_revenue_total numeric)
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative, t.est_revenue_total
  from competitor.track_daily_streams t
  where t.date >= p_start
    and t.date >= competitor.stream_history_hot_from()
    and t.date <= p_end
    and (p_isrcs is null or t.isrc = any (p_isrcs))
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v, competitor.stream_est_revenue(u.v)
  from competitor.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < competitor.stream_history_hot_from()
    and (p_isrcs is null or m.isrc = any (p_isrcs))
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;
