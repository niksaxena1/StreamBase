-- Same vault fix as own (20261014160000): authenticated cannot read the R2 credentials, so the authenticated-facing
-- competitor view must not include the archive tier. hot + compact + overrides only; the full view is service_role only.
create or replace view competitor.track_daily_streams_effective_public as
 select t.date,
        t.isrc,
        coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative
   from (
         select d.date, d.isrc, d.streams_cumulative
           from competitor.track_daily_streams d
          where d.date >= competitor.stream_history_hot_from()
         union all
         select c.d as date, m.isrc, m.vals[extract(day from c.d)::integer] as streams_cumulative
           from (select (date '2025-01-01' + g.i) as d
                   from generate_series(0, 5000) g(i)
                  where (date '2025-01-01' + g.i) < competitor.stream_history_hot_from()) c
           join competitor.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
          where m.vals[extract(day from c.d)::integer] is not null
        ) t
   left join competitor.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
 union all
 select o.date, o.isrc, o.streams_cumulative_override
   from competitor.track_daily_stream_overrides o
  where o.date >= competitor.stream_compact_from()
    and not exists (select 1 from competitor.track_daily_streams t
                     where t.date = o.date and t.isrc = o.isrc and t.date >= competitor.stream_history_hot_from())
    and not exists (select 1 from competitor.track_streams_monthly m
                     where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                       and m.month < competitor.stream_history_hot_from()
                       and m.vals[extract(day from o.date)::integer] is not null);
revoke all on competitor.track_daily_streams_effective from anon, authenticated;
grant select on competitor.track_daily_streams_effective to service_role;
notify pgrst, 'reload schema';
