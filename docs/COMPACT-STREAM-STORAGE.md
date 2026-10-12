# Compact stream storage (hybrid daily + monthly arrays)

Status (Oct 12 2026): tables, functions and views created and populated; PHASE 2 SWITCHOVER DONE (see the last section).
The old daily partitions are still in place; the owner removes them with `supabase/manual/2026-10-12_remove_packed_partitions.sql`.

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


## Phase 2 switchover (done, Oct 12 2026)

Nothing reads packed months from the daily partitions any more. Every repointed function was hashed before/after
(row count + md5 of sorted rows) on arguments that span packed months; all identical.

### Views (column lists unchanged; Ledgenta's `public.track_daily_streams_effective_public` untouched, grants identical)
- `<schema>.track_daily_streams_base_all`: daily rows from `stream_history_hot_from()` + packed months expanded through a
  calendar join (date, isrc and date-range predicates prune to the needed months). `source_run_id` / `base_created_at`
  are NULL for packed months (nothing reads them for old data).
- `<schema>.track_daily_streams_all` and `<schema>.track_daily_streams_effective` read from it.
  `competitor.track_daily_streams_effective_public` was reading the table directly and now reads it too.
- `<schema>.track_daily_streams_effective_hot`: effective rows for the hot window only, used by "latest and previous
  snapshot" readers.

### Functions
- Through `*_all`: `catalog_artist_series_fast` (range_isrcs), `collector_artists_stats_paged`,
  `health_missing_catalog_tracks_detailed`, `playlist_top_tracks`, `health_daily_stream_totals`, `effective_streams_for_date`
  (range), competitor `home_artificial_stream_spikes`, `home_negative_daily_streams`, `home_track_scatter_points_for_label`,
  `home_artist_weekend_dips`, `home_track_weekend_dips`.
- Rewritten for speed (same output): public `home_negative_daily_streams` (one lag pass), `health_negative_daily_streams`
  (two days only), the four public weekend-dip functions (`_latest_data_sunday`, `track_daily_streams_effective_range`),
  `network_selection_scoped_track_totals` (both schemas), `catalog_config_*`, `network_export_artist_stream_stats`
  (hot views + `effective_latest_date()` / `effective_previous_date()`).
- Everything else already read through `*_effective` and follows the views.
- Deliberately still on the daily table (windows are always inside the hot window): `_catchup_plan`,
  `spotibase_interpolate_stale_streams`, `spotibase_rebase_downward_revisions`, `spotibase_reconcile_auto_overrides`,
  `spotibase_stale_summary`, `spotify_availability_candidates`, `spotibase_system_stats` (row estimate; shrinks after removal),
  the max/min bounds in the competitor weekend-dip functions, the packers and the hot halves of the views.

### App / scripts
- `web`: `api/competitors/date-breakdown` and `lib/health/fetchWarningDetails` read `track_daily_streams_all`.
  Latest-date reads (`playlists/page`, `isrc-batch-details`, `search-stats`, `loadHomeDashboard`) stay on the daily table.
- Ingest scripts: `streambase_postgrest.upsert_daily_streams` warns when a write lands before the cutoff, re-packs that
  month if the write succeeded, and skips with a warning if the partition no longer exists.

### Monthly job
`ops.pack_aged_stream_months()` via pg_cron `streambase-pack-stream-month` (`40 3 1-3 * *` UTC): packs every unpacked month
up to current month minus 4 (both schemas), raises `ops.pipeline_alerts` rows `pack_stream_month_failed` on errors and
`partition_ready_to_remove_YYYY_MM` after each pack (the removal itself stays an owner paste).

### Measured cost of the history-aware path (warm)
Bulk reads of the whole effective view are about 2x the old table scan (full scan 1.16 s vs 0.52 s), month-wide all-track
ranges through `*_effective_public` about 5x (390 ms vs 75 ms), ISRC-list + range 450 ms vs 175 ms. Point lookups are
8-10 ms vs 2-3 ms. Ledgenta-style queries (single ISRC, ISRC list) stay in the same order of magnitude.

## Phase 3: R2 archive tier (Oct 12 2026)

Three tiers behind the same views, so every page, SQL function, chart and Ledgenta keep working with identical output:

| Tier | Dates | Storage |
|---|---|---|
| daily | `>= stream_history_hot_from()` | partitioned `track_daily_streams` |
| compact | `stream_compact_from()` .. daily | `track_streams_monthly` |
| archive | `< stream_compact_from()` | one gzip CSV per universe per month in Cloudflare R2, read through the Supabase Wrappers S3 foreign data wrapper |

`stream_compact_from()` = the earliest month still in `track_streams_monthly` (SECURITY DEFINER, like `stream_history_hot_from()`; invoker versions broke anon reads once). Policy: `ops.stream_archive_config.packed_months_keep` = 12 packed months stay in compact; older months become due. Nothing is due yet (first due month: about Sep 2027), so the archive is empty in production; the tier is fully built and proven by the self-test.

### Files
`<prefix>/<own|competitor>/archive_<YYYY-MM>.csv.gz`, header `kind,d,isrc,v,oid,note,created_by,created_at`; `kind s` = stream row (`v` = cumulative streams), `kind o` = override row (`d` = date, `v` = override value, `oid/note/created_by/created_at` = override metadata). NULL = `\N`. One file holds both so the archive tier is one grouped scan (stream value, override value and override metadata per (date, isrc)); DB overrides always win over archived ones. Measured: own 2026-01 = 21,429 stream rows + 1 override = 117 KiB gz; competitor 2026-05 = 109,701 + 1,103 overrides = 618 KiB gz. (Compact copies of the same months are about 1 and 4 MB.)

### Why CSV.gz and not Parquet
Parquet was tried first and cannot be read from R2 by this FDW: every Parquet file (uncompressed, snappy, gzip, zstd) failed with `read parquet failed: Parquet error: External: service error`, while a CSV in the same bucket with the same server and credentials read fine, so credentials, endpoint and region (`auto`) are right and the failure is in the FDW's Parquet reader against R2 (it issues ranged/streamed reads; the root cause was not isolated). It is not known whether the documented load-whole-file behaviour is the reason. The FDW's CSV reader returns correct values only for text columns (typed date/bigint columns came back as garbage), so the foreign tables are all text and the views cast; hence the `ops.iso_date()` wrapper (IMMUTABLE, so the planner can use it in CHECK windows).

### How a read is kept off R2
Each archived month is an inheritance child (foreign table) of an empty parent (`stream_archive.<u>_rows`) with `CHECK (ops.iso_date(d) in the month)`. Constraint exclusion removes children outside the query's date range at plan time, so recent-range queries never open a foreign scan (proven by the self-test with EXPLAIN ANALYZE: `Actual Loops` of every Foreign Scan is 0 or the node is absent). Unbounded readers are bounded: SQL with `stream_compact_from()`, web with `recentStreamFloor()`. A query that does touch archived months loads those months' whole files (no pushdown, no cache): about 1-3 s per month file normally, but R2 calls from Supabase are bimodal and have taken 10-40 s when a connection stalls. Archive is cold storage.

### Workflow (`.github/workflows/stream_archive.yml`, `scripts/archive_stream_months.py`)
- `archive` (day 4, 03:10 UTC): for each due month export from Postgres (RPCs `stream_month_export` / `stream_overrides_export`), upload to R2, `attach` (create the child foreign table + verify: stream rows vs the compact month and override rows vs the DB overrides, counts + EXCEPT ALL both ways), then `finalize` (owner paste `supabase/manual/2026-10-12_stream_archive_finalize.sql`: re-verifies, removes only DB override rows identical to archived ones and the month's compact row set, oldest month first). If finalize is not installed the month stays in compact and one alert is raised.
- `selftest` (day 5 03:10 UTC, and manual): archives a COPY of the earliest compact month of each universe under `<prefix>/_selftest/`, serves it through the `archive_selftest.*` views (same view text as the live ones, generated from `scripts/gen_stream_archive_sql.py`), compares with the live views across the archive/compact boundary and around an override, proves the pruning, removes nothing from real data.
- The heavy steps run as one-shot pg_cron jobs (`streambase-archive-job-<id>`, kinds `selftest_verify`/`attach`/`finalize`, table `ops.stream_archive_jobs`) because the API statement timeout is 8 s; the workflow enqueues and polls. Jobs have a 15 minute limit and cannot loop.
- Emails (`ops.pipeline_alerts`) on failure only; scheduled runs email, manual `workflow_dispatch` runs do not unless `notify=true`.

### Limits
- An archived override cannot be removed with `spotibase_remove_stream_override`; to change an archived value add a DB override for the same (date, isrc) (it wins).
- Raw ingestion writes to archived dates are skipped with a warning (`upsert_daily_streams`); overrides on archived dates still work.
- Settings "earliest data date" and per-track history charts show the last 365 days (identical today).

### If R2 is unreachable
Recent and compact data keep working (archive branches are never executed). A query whose date range includes an archived month fails with a foreign-table error (`HV000 ... request failed` / `read ... failed`). Check, in order: the vault secrets `r2_*` and the R2 token (Object Read & Write on the bucket), `select * from ops.stream_archive_config`, then run the `Stream Archive (R2)` workflow in `selftest` mode (manual, no email). Files are plain gzip CSV in the bucket, so they can also be read or restored without the FDW.
