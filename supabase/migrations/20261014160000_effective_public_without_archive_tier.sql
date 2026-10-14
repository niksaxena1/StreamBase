-- Anon/authenticated cannot read the R2 credentials (vault) the S3 foreign tables need, and the planner opens the
-- foreign tables even for recent-range queries, so ANY non-service role reading a view that includes the archive
-- tier fails with "permission denied for schema vault" as soon as the first month is archived.
-- track_daily_streams_effective_public is the anon/authenticated-facing view: serve it from hot + compact (+ overrides)
-- only. The compact tier always covers at least the last 12 months. Full history (incl. R2) stays in
-- track_daily_streams_effective, which only service_role can read (service_role has vault access).
create or replace view public.track_daily_streams_effective_public as
 select t.date,
        t.isrc,
        coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative
   from (
         select d.date, d.isrc, d.streams_cumulative
           from public.track_daily_streams d
          where d.date >= public.stream_history_hot_from()
         union all
         select c.d as date, m.isrc, m.vals[extract(day from c.d)::integer] as streams_cumulative
           from (select (date '2023-01-01' + g.i) as d
                   from generate_series(0, 5000) g(i)
                  where (date '2023-01-01' + g.i) < public.stream_history_hot_from()) c
           join public.track_streams_monthly m on m.month = date_trunc('month', c.d)::date
          where m.vals[extract(day from c.d)::integer] is not null
        ) t
   left join public.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
 union all
 select o.date, o.isrc, o.streams_cumulative_override
   from public.track_daily_stream_overrides o
  where o.date >= public.stream_compact_from()
    and not exists (select 1 from public.track_daily_streams t
                     where t.date = o.date and t.isrc = o.isrc and t.date >= public.stream_history_hot_from())
    and not exists (select 1 from public.track_streams_monthly m
                     where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                       and m.month < public.stream_history_hot_from()
                       and m.vals[extract(day from o.date)::integer] is not null);
notify pgrst, 'reload schema';

-- The full view (includes the R2 tier) must not be readable by roles without vault access.
revoke all on public.track_daily_streams_effective from anon, authenticated;
grant select on public.track_daily_streams_effective to service_role;
