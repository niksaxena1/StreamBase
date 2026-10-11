-- One-off data correction (competitor universe only), 2026-10-11.
-- SpotOnTrack lag: run dates 2026-10-08 and 2026-10-09 got ~0.62x a normal day's
-- growth and 2026-10-10 got ~2.18x (catch-up). For tracks whose 10-Oct growth
-- exceeds 1.5x their fair share of the 7->10 Oct growth (11,540 tracks), spread the
-- growth evenly: 8 Oct = 7 Oct + 1/3, 9 Oct = 7 Oct + 2/3 of (10 Oct - 7 Oct).
-- 7 Oct and 10 Oct values (SpotOnTrack anchors) are untouched. Only override rows are
-- written/updated; no data is deleted. Undo: delete overrides with this note.
-- Note prefix is not 'auto-%', so automatic reconcile/rebase jobs leave these alone.

with e as (
  select isrc, date, streams_cumulative v
  from competitor.track_daily_streams_effective_public
  where date between '2026-10-07' and '2026-10-10'
),
p as (
  select isrc,
         max(v) filter (where date = '2026-10-07') d7,
         max(v) filter (where date = '2026-10-09') d9,
         max(v) filter (where date = '2026-10-10') d10
  from e group by isrc
),
sel as (
  select * from p
  where d7 is not null and d10 is not null and d10 > d7
    and (d10 - d9) > 1.5 * ((d10 - d7) / 3.0)
),
rows as (
  select '2026-10-08'::date as date, isrc, (d7 + round((d10 - d7) / 3.0))::bigint as v from sel
  union all
  select '2026-10-09'::date, isrc, (d7 + round(2 * (d10 - d7) / 3.0))::bigint from sel
)
insert into competitor.track_daily_stream_overrides (date, isrc, streams_cumulative_override, note)
select date, isrc, v, 'manual-catchup:2026-10-08..10 even split (SOT lag; anchors 10-07/10-10 kept)'
from rows
on conflict (date, isrc) do update
  set streams_cumulative_override = excluded.streams_cumulative_override,
      note = excluded.note;

-- Recompute competitor playlist/label daily stats from 8 Oct onwards.
select competitor.spotibase_recompute_playlist_daily_stats_cascade('2026-10-08'::date);
