# Compact stream storage (hybrid daily + monthly arrays)

Status: tables, functions and views created and populated (Oct 12 2026). Nothing existing was altered or removed.
Old daily partitions are still in place; readers have not been repointed yet.

## Design

- Recent months stay in the partitioned daily tables (`public.track_daily_streams`, `competitor.track_daily_streams`). Writers, repairs and recent-window queries are unchanged.
- Whole older months are packed into `<schema>.track_streams_monthly(isrc, month, vals bigint[], packed_at)`; PK `(isrc, month)`, extra index on `(month)`. `vals[d]` = cumulative streams on day-of-month `d`, `NULL` = no row that day. RLS on, `service_role` only.
- Competitor `est_revenue_total` is NOT stored: it equals `streams_cumulative * 0.002` in float8, rendered through shortest round-trip text (`competitor.stream_est_revenue(bigint)`, `extra_float_digits = 3`). Verified exact on all 1,588,124 rows; `competitor.pack_stream_month` re-checks each month and refuses to pack if it ever stops being true.
- `<schema>.stream_history_hot_from()` = first day still served from the daily table = (latest packed month + 1 month). The readers use it so packed months that still exist as daily partitions are never double counted. Packing a month therefore flips that month to the compact side atomically.
- Readers:
  - `<schema>.track_daily_streams_range(p_start, p_end)` all tracks, only touches needed months (plan shows compact branch skipped for recent windows). Do not pass the 3rd arg (see below).
  - `<schema>.track_daily_streams_range_isrcs(p_start, p_end, p_isrcs text[])` ISRC-scoped; uses the `(isrc, date)` and `(isrc, month)` indexes.
  - `<schema>.track_daily_streams_all` full-history view. Good for single-ISRC filters and ad-hoc work; a date-only filter unnests the whole compact table (about 100 ms), so prefer the functions in hot paths.
  - The 3-arg `track_daily_streams_range(..., p_isrcs)` is superseded: `p_isrcs is null or ...` blocks index use when the array is not a plan-time constant (3 s vs 80 ms). Leave it unused; the owner can remove it later.
- Migrations: `20261012120000_add_compact_stream_history.sql`, `20261012121500_compact_stream_history_parallel_safe.sql`, `20261012123000_add_compact_stream_history_isrc_range.sql`.

## Packed so far (hot window = 2026-07-01 onward)

public 2026-01..06 (17,125 rows), competitor 2026-05..06 (19,628 rows). Daily-vs-compact `EXCEPT ALL` is 0 in both directions for every month.

## Switchover plan

### (i) Repointing readers

"Recent" = only touches dates within the last ~30 to 120 days; keep on the daily table, no change. "History" = can span more than the hot window; switch the base-table read to the range function.

History readers (need more than 4 months), both schemas unless noted:
- `catalog_artist_series_fast`, `catalog_artist_series` -> `track_daily_streams_range_isrcs(start, end, arr)` (replace the `base` CTE; overrides CTE stays as is).
- `track_series(isrc, start, end)` (public) -> `range_isrcs(start, end, array[isrc])`.
- `collector_tracks`, `collector_tracks_paged`, `collector_tracks_paged_scoped` (start/end range).
- `home_track_scatter_points`, `competitor.home_track_scatter_points_for_label` (start/end).
- `home_artificial_stream_spikes` (start/end) both schemas.
- `health_daily_stream_totals(start, end[, label])`.
- `playlist_top_tracks(playlist, start, end, n)`.
- `home_negative_daily_streams()`, `health_negative_daily_streams(label)`: full-history lag windows. Either keep them scanning only the hot window (recommended: negative deltas older than 4 months are not actionable) or read `track_daily_streams_all`. Measured: own 1.6 s current vs 2.7 s via view; competitor May-Oct 23 s vs 20 s (already heavy, add a date floor).
- `track_daily_streams_effective`, `track_daily_streams_effective_public`: see (iv).

Point-in-time / as-of readers (single date `d`, plus lookback such as d-1, d-7, d-30): recent unless the UI lets users pick an old date. Keep on the daily table and wrap with `range(d - lookback, d)` only if old dates must keep working. Verify each body for its lookback: `artist_total_streams_for_date`, `track_total_streams_for_date`, `playlist_total_streams_for_date`, `effective_streams_for_date`, `catalog_artist_top_tracks_daily/_total`, `playlist_top_tracks_total`, `collector_artists_stats_paged(_scoped)`, `catalog_config_artist_rows/track_rows`, `label_artists_paged`, `label_tracks_paged`, `label_top_tracks_daily`, `playlist_current_tracks`, `network_selection_scoped_track_totals`, `network_export_artist_stream_stats`, `home_artist_weekend_dips`, `home_track_weekend_dips` (weekend dips look back weeks only), `health_missing_catalog_tracks(_detailed)`, `health_playlist_missing_catalog_tracks`, `health_unplayable_candidates`, `spotify_availability_candidates`, `spotibase_system_stats` (row counts; will undercount after removal, switch to `count(*)` of daily + sum of non-null array elements, or accept).

Recent-only by nature, never repoint: `_catchup_plan`, `spotibase_interpolate_stale_streams`, `spotibase_rebase_downward_revisions`, `spotibase_reconcile_auto_overrides`, `spotibase_stale_summary`, `spotibase_recompute_playlist_daily_stats`, `ensure_track_daily_streams_partitions`.

App code (web/src): `playlists/page.tsx:280`, `api/admin/isrc-batch-details`, `api/competitors/date-breakdown`, `api/search-stats`, `lib/health/fetchWarningDetails.ts:226`, `lib/home/loadHomeDashboard.ts:430`, docs stats. Any read with a date range or no date bound that can exceed the hot window must call the range RPC (add a thin wrapper RPC exposed to the server client) instead of `from('track_daily_streams')`. `scripts/artist_tools_daily.py:118` embeds `latest:track_daily_streams(...)` (latest day only): unaffected because it only reads recent rows and the FK to `tracks` stays on the daily table.

Order: (1) repoint one function at a time with `create or replace`, compare output with the old body on the same arguments (`EXCEPT ALL`), (2) deploy app reads, (3) only then remove partitions.

### (ii) Writers

No change. Both ingest scripts keep upserting into the daily tables. Caveat: ingestion that backfills or re-ingests a date inside an already packed month would write to the daily partition (or fail if that partition was removed, because `ensure_*_partitions` only creates current and future months) and the compact row would not see it, because readers ignore daily rows before `hot_from`. Repairs of packed months must be done by re-creating the partition, loading the rows, then re-running `pack_stream_month(month)` (upsert). Rows that existed in compact but were removed from daily are not cleaned automatically (no delete in the pack function); a month with removed ISRC rows needs a manual cleanup.

### (iii) Monthly job and partition removal

Policy: on the 1st of month M pack month M-4 (keeps 3 full months plus the current one, matching today's hot_from of 2026-07-01 on 2026-10-12; on 2026-11-01 it packs July).

```sql
select cron.schedule('streambase-pack-stream-month', '30 3 1 * *', $$
  select public.pack_stream_month((date_trunc('month', current_date) - interval '4 months')::date);
  select competitor.pack_stream_month((date_trunc('month', current_date) - interval '4 months')::date);
$$);
```

Add it to the existing ops scheduler if preferred (`ops.pipeline_tick` runs 04:00-12:55 UTC every 5 minutes; a separate monthly cron job is simpler and keeps own/competitor concerns separate).

Before removing a partition, prove equality (example for own, month 2026-01; competitor is identical with its extra column):

```sql
select count(*) from (
  select date, isrc, streams_cumulative from public.track_daily_streams_y2026m01
  except all
  select (m.month + (u.d - 1)::int), m.isrc, u.v
  from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality u(v, d)
  where m.month = '2026-01-01' and u.v is not null) x;   -- must be 0, and run the reverse direction too
```

Removal (owner pastes; irreversible, take a backup or keep the exports first). Own, months 2026-01..06:

```sql
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m01;
drop table public.track_daily_streams_y2026m01;
-- repeat for m02..m06
alter table competitor.track_daily_streams detach partition competitor.track_daily_streams_y2026m05;
drop table competitor.track_daily_streams_y2026m05;
-- repeat for m06
```

Do this only after step (i) is complete and verified. Reclaimed space is released to the OS only if the partition is dropped (not just deleted from); a plain `drop table` is enough on Supabase for the database size counter. Expected effect: public 81.1 MB + competitor 77.1 MB = 158.2 MB removed, 12.0 MB added.

### (iv) Ledgenta view stays column-identical

`public.track_daily_streams_effective_public` selects `date, isrc, streams_cumulative` from `track_daily_streams_effective`. Do not change it until partitions are about to be removed, then `create or replace view public.track_daily_streams_effective` with the same 10 columns, replacing the left side with a base subquery:

```sql
-- base = daily rows from hot_from, plus unnested compact months (source_run_id and base_created_at are NULL for compact rows)
select t.date, t.isrc, t.streams_cumulative, t.source_run_id, t.created_at as base_created_at
from public.track_daily_streams t where t.date >= public.stream_history_hot_from()
union all
select (m.month + (u.d-1)::int), m.isrc, u.v, null::uuid, null::timestamptz
from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality u(v,d)
where m.month < public.stream_history_hot_from() and u.v is not null
```
then the existing `LEFT JOIN track_daily_stream_overrides o` and the existing second `UNION ALL` branch (overrides without a base row; its `NOT EXISTS` must check the same base subquery). `create or replace view` keeps column names/types/order, so Ledgenta's anon-key queries are unaffected. Measured on the `_all` view: single-ISRC filter 2.7 ms (same as base), date-only filter 105 ms vs 1 ms. If Ledgenta does date-only point queries on old dates, test them against this view before the switch. `source_run_id` / `base_created_at` are lost for packed months (nothing in the repo reads them for old data; confirm for Ledgenta).

### (v) Rollback

Everything is additive. To roll back before partitions are removed: repoint any changed function back with its previous body (keep the old bodies in the migration that changes them), and either ignore the compact tables (they do not affect the daily table) or re-pack. After partitions are removed, rollback = re-create the partition (`create table ... partition of ... for values from ... to ...`) and insert from the compact view: `insert into public.track_daily_streams (date, isrc, streams_cumulative) select date, isrc, streams_cumulative from public.track_daily_streams_all where date >= '2026-01-01' and date < '2026-02-01'` (set `hot_from` aside first, i.e. read directly from `track_streams_monthly`; `source_run_id` and `created_at` cannot be restored; competitor `est_revenue_total` via `competitor.stream_est_revenue`).

## Measurements (warm, Supabase Free, ms)

| Query | Current | New |
|---|---|---|
| (a) own, last 35 days all tracks | 24 | 49 (range fn), 122 (view) |
| (a) competitor, last 35 days all tracks | 81 | 197 (range fn), 255 (view) |
| (b) own, one artist (259 ISRCs), Jan-Oct | 63 | 80 (range_isrcs); view 7,300 (do not use for ISRC sets) |
| (b) single ISRC via view | 0.6 | 2.7 |
| (c) own, all-tracks lag window, full history | 1,570 | 2,700 (range fn and view) |
| (c) competitor, all-tracks lag window, May-Oct (cold, 1 run) | 23,100 | 20,200 (view) |
| date-only point lookup (one day) | 1 | 105 (view) |

For recent windows keep reading the daily table directly (zero change); the range function only matters for history.

## Open risks

- Backfills into packed months (see ii).
- `source_run_id` / `created_at` are not retained for packed months.
- Date-only lookups on old dates through the view cost about 100 ms.
- The ~25 history-capable functions must be repointed one by one; each needs an output diff.
- Space is only reclaimed after the owner removes the partitions.
