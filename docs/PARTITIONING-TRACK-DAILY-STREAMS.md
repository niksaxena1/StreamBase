# What the `track_daily_streams` partition migration does

## In plain terms

**Before:** `track_daily_streams` was one big table. Every day you insert rows for that date (one row per track). Over years the table gets huge (millions of rows). Queries that filter by `date` still have to scan one large table and its indexes.

**After:** The table is **partitioned by month**. Physically, the data is split into separate tables (partitions), one per month, e.g.:

- `track_daily_streams_y2026m01` — all rows where `date` is in January 2026  
- `track_daily_streams_y2026m02` — February 2026  
- …  
- `track_daily_streams_y2027m12` — December 2027  

You still query the **same** name: `track_daily_streams`. Postgres automatically looks only at the partition(s) that can contain the dates you asked for (partition pruning). So:

- **Faster queries** — e.g. “streams for 2026-03-15” only touches the March 2026 partition.
- **Easier maintenance** — you can drop or archive old partitions in one go instead of deleting rows from a single huge table.
- **Same app code** — views and RPCs keep using `track_daily_streams`; they don’t need to know about partitions.

The tradeoff: **you must create a new partition before inserting data for a new month.** If you try to insert a row with `date = '2028-01-15'` and there is no partition for January 2028, the insert will fail. That’s why we have `ensure_track_daily_streams_partitions()` and an automated task to run it.

## What was done in the migration (one-time)

1. Rename the original table to `track_daily_streams_old`.
2. Create a new **partitioned** table named `track_daily_streams` with the same columns, partitioned by `date` (by month).
3. Create partitions for a range of months (e.g. 2026–2027).
4. Copy all rows from `track_daily_streams_old` into `track_daily_streams` (so data lives in the right monthly partitions).
5. Recreate the views that depend on it (`track_daily_streams_effective`, `track_daily_streams_effective_public`) so they point at the new partitioned table.
6. Drop the old table.
7. Add a helper function `ensure_track_daily_streams_partitions(months_ahead)` that creates any missing partitions for the next N months.

## What you need to do on an ongoing basis

Run `ensure_track_daily_streams_partitions()` periodically (e.g. **once a month**) so that future months always have a partition before your ETL or app inserts data. You can do that by:

- **Automated:** Vercel Cron calling the app’s `/api/cron/ensure-partitions` route (see repo), or Supabase `pg_cron` if you enable it.
- **Manual:** Running `SELECT ensure_track_daily_streams_partitions(6);` in the Supabase SQL editor (e.g. on the 1st of each month).

With the default `months_ahead = 6`, each run ensures the current month plus the next 6 months have partitions, so monthly execution is enough.
