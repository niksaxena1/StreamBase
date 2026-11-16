# Organic daily streams for collectors (plan)

Status: built 17 Nov 2026. Owner choices: Collectors only; skip pairs without a row on both days; no movement line;
**Net stays the default** and Organic is an optional header toggle (`?basis=organic`). During the build, rows of 0
(takedowns, e.g. 01 Oct 2026) were also treated as missing, so organic needs a count above 0 on both days.

## Problem

`playlist_daily_stats.daily_streams_net` is *today's playlist total minus yesterday's playlist total*
(`spotibase_recompute_playlist_daily_stats`, and the same formula in `scripts/ingest_exports_to_supabase.py`).
When a track joins a playlist, its whole lifetime count is added; when it leaves, or misses a snapshot, the
whole count is subtracted. `collector_daily_agg` sums these per collector, so moves between distributors
show up as giant fake days. The Collectors page also builds its monthly and metric charts from day-to-day
changes in `total_streams_cumulative`, so the same artefact reaches those charts.

Measured (run dates; table on the page shows data date = run date − 1):

| Date   | Collector | net (today) | organic (same tracks) | Tracks |
|--------|-----------|-------------|-----------------------|--------|
| 12 Nov | N  | 26,073      | 26,073  | 227 |
| 13 Nov | N  | −34,034,946 | 22,429  | 227 → 193 |
| 13 Nov | TG | +31,566,264 | 555,743 | 2,174 → 2,212 |
| 14 Nov | TG | +2,413,029  | 583,614 | 2,212 → 2,213 |
| 12 Nov | PL | 814,335     | 814,335 | 747 |

On days without membership changes the two match exactly, so organic is a safe drop-in for every normal day.

## Definition

For playlist P on date d:

    organic(P, d) = Σ over ISRCs in P on both d−1 and d,
                    with a stream row on both days, of (cum(d) − cum(d−1))

- Tracks that joined today, left today, or lack a snapshot on either day contribute nothing (not ± their lifetime).
- `movement(P, d) = net − organic` is what moved in or out (useful as a tooltip line, optional).
- Source: `track_daily_streams_effective_public` (overrides included), the same view recompute already reads.

Cost: one query over all 17 collector playlists for 7 days took ~400 ms, so per date it's well under 100 ms.

## Build steps

1. **Migration** `supabase/migrations/<ts>_add_playlist_daily_streams_organic.sql`
   - `alter table public.playlist_daily_stats add column daily_streams_organic bigint, add column est_revenue_daily_organic numeric;`
   - Extend `spotibase_recompute_playlist_daily_stats(p_date)` to compute both columns (membership on both
     days via `valid_from <= d−1 and (valid_to is null or valid_to >= d)`, joined to today's and yesterday's
     stream rows; `all_catalog` derived from releases/ext exactly as now). Null when yesterday has no stats row,
     matching the net column's first-day rule.
   - `create or replace view collector_daily_agg` / `collector_daily_compare`: append the organic sums plus
     organic `_delta_yday`, `_ma7_prev`, `_delta_ma7` at the end (appending columns keeps the views replaceable).
   - Keep existing grants; update `docs/` notes about the column.
2. **Backfill**: run the recompute for every date in `playlist_daily_stats` (297 dates from 24 Jan 2026,
   ~7k rows). All are ≥ `stream_compact_from()` (01 Oct 2025), so no R2 archive reads. Run oldest → newest,
   in batches, from the DB, not via PostgREST loops.
3. **Python ingest** (`ingest_exports_to_supabase.py`, ~line 1210): after it upserts the day's stats, call
   `spotibase_recompute_playlist_daily_stats(run_date)` so organic is filled in the same run (or confirm the
   DB-run pipeline's cascade already does this for every ingest path). Add a test.
4. **Collectors UI** (`page.tsx`, `CollectorsClient.tsx`, `collectorsUtils.ts`, chart components):
   - Read `daily_streams_organic` / `est_revenue_daily_organic` and the organic compare columns instead of
     the net ones for the table, comparison chart, 7-day avg, yesterday and sparkline.
   - Monthly bars and metric "daily" series: sum the organic daily column instead of differencing
     `total_streams_cumulative` (this also fixes PL's Jan 26 bar of ~220M against ~25M other months, if
     that's caused by playlists joining; check after the backfill).
   - Remove the negative-average stopgap from 1462a40 once organic is live.
   - Optional: tooltip line "Moved in/out: ±X" from net − organic on days where they differ.
5. **Verify**: 13 Nov N ≈ 22k and TG ≈ 556k on the page; normal days unchanged; vitest/tsc/eslint; push.

## Owner decisions

1. **Scope**: Collectors only first (recommended), or also switch the Playlists page and Home
   `all_catalog` daily figures? Those read the same column and have the same artefact when playlists change.
2. **Missing snapshot rule**: a track with no row on one of the two days is skipped (slight undercount for
   that day). Alternative: carry the last known value across the gap. Skipping is simpler and never invents streams.
3. **Movement line**: show "moved in/out" in tooltips, or keep it hidden?

Not in scope: competitor schema (separate universe with its own stats and recompute; same idea would apply later).
