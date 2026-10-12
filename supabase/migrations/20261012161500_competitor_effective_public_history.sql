-- Phase 2 / step 1b: competitor.track_daily_streams_effective_public read the daily table directly (not via
-- competitor.track_daily_streams_effective). Same columns/types/order; base rows now come from the
-- history-aware base so packed months stay visible after the old partitions are removed.
create or replace view competitor.track_daily_streams_effective_public as
  select t.date, t.isrc, t.streams_cumulative
  from competitor.track_daily_streams_base_all t
  where not exists (select 1 from competitor.track_daily_stream_overrides o where o.date = t.date and o.isrc = t.isrc)
  union all
  select o.date, o.isrc, o.streams_cumulative_override as streams_cumulative
  from competitor.track_daily_stream_overrides o;
