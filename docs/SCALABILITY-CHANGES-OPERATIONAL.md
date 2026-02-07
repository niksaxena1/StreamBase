# Operational notes: scalability changes

Things to be aware of after the recent scalability and performance changes.

---

## 1. **Partitioned `track_daily_streams` (if applied)**

If you applied the migration that partitions `track_daily_streams` by month:

- **New partitions**  
  Inserts for a new month will fail until a partition for that month exists. The helper `ensure_track_daily_streams_partitions(months_ahead)` creates any missing monthly partitions.

- **Automated (recommended)**  
  The app includes a cron endpoint that runs this for you:
  1. **Vercel:** Set a **CRON_SECRET** env var in your Vercel project (e.g. `openssl rand -hex 32`). Vercel will send it when triggering the cron.
  2. **Schedule:** `vercel.json` is set to call `/api/cron/ensure-partitions` on the **1st of every month at 00:00 UTC**. No extra setup needed once CRON_SECRET is set.
  3. **Manual test:** `GET /api/cron/ensure-partitions` with header `Authorization: Bearer <CRON_SECRET>` (or from the Vercel Cron tab).

- **Alternative:** Run `SELECT ensure_track_daily_streams_partitions(6);` in the Supabase SQL editor (e.g. on the 1st of each month). See also `docs/PARTITIONING-TRACK-DAILY-STREAMS.md`.

---

## 2. **Collectors page: “All time” is last 365 days for non-daily views**

- **What changed**  
  The comparison chart data for **Weekly / Monthly / Quarterly / Yearly** is no longer unbounded “all time”. It is capped to the **last 365 days** of data to limit payload size.

- **What to watch**  
  If you have data older than a year, those older points will not appear when you switch to weekly/monthly/quarterly/yearly. The **Daily** view still uses the selected date range and is not capped.

- **If you need true all-time for non-daily**  
  You can later switch the app to use the `collector_daily_agg_bucketed` RPC (server-side aggregation) and pass a wider or unbounded range, then remove the 365-day cap.

---

## 3. **Home page scatter: single large RPC**

- **What changed**  
  The home scatter plot is loaded via one RPC, `home_track_scatter_points`, which returns all points for the selected run date (up to a large cap, e.g. 25k).

- **What to watch**  
  If your catalog grows a lot (e.g. tens of thousands of tracks), that single response can get big. If the home page starts to feel slow or time out, consider adding server-side pagination or a lower cap and “Load more” in the UI.

---

## 4. **Playlists: latest track count from `playlist_daily_stats`**

- **What changed**  
  Playlist “latest track count” comes from the batch RPC `playlists_latest_track_counts`, which uses `playlist_daily_stats` and “latest” = most recent `date` per playlist.

- **What to watch**  
  If a playlist has **no row** in `playlist_daily_stats` (e.g. new playlist or a missed ETL run), it will not appear in the batch result, so the UI may show no count or treat it as missing. Ensure your pipeline always writes at least one row per playlist per run so “latest” is well-defined.

---

## 5. **Health page: many warnings = many parallel RPCs**

- **What changed**  
  Fetching details for each warning (non-catalog tracks, track count swing, missing enrichment) is done in parallel with `Promise.all` instead of sequentially.

- **What to watch**  
  With many warnings (e.g. dozens of playlists), the health page can trigger many concurrent RPCs. If you hit connection limits or see timeouts under load, consider batching (e.g. run in chunks of 5–10) or adding a limit on how many warnings are expanded at once.

---

## 6. **Charts: downsampling to 400 points**

- **What changed**  
  Daily/total streams chart data is downsampled to at most **400 points** before rendering to keep Recharts performant.

- **What to watch**  
  Over very long ranges you may lose some fine detail (e.g. a single-day spike might be slightly smoothed). The algorithm keeps bucket boundaries and the point with the largest value in each bucket, so major peaks should still be visible.

---

## 7. **Catalog: Artists and Tracks lists – “Show more”**

- **What changed**  
  Artists and Tracks lists initially render **150 rows** and then “Show more” adds another 150 each time.

- **What to watch**  
  - Users must click “Show more” to see beyond the first 150; nothing beyond that is hidden, it’s just loaded progressively.  
  - Any feature that assumes “all rows are in the DOM” (e.g. “Select all” or “Export visible list” that only looks at rendered rows) will only see the currently loaded set. If you add such features, implement them against the full dataset (e.g. API or client state), not the DOM.

---

## 8. **Images: `next/image` and allowed domains**

- **What changed**  
  All previous `<img>` usages for album/artist/playlist art were switched to Next.js `Image` (with explicit `width`/`height`). Only **`i.scdn.co`** is in `images.remotePatterns` in `next.config.ts`.

- **What to watch**  
  If you add images from another domain (e.g. another CDN or API), you must add that host to `images.remotePatterns` in `next.config.ts`, or those images will not load.  
  If you change thumbnail sizes in the UI (e.g. from `h-8 w-8` to `h-10 w-10`), update the `width`/`height` props on the corresponding `Image` components to match to avoid layout shift or blur.

---

## 9. **Caching and cache keys**

- **What changed**  
  Several pages use `cachedQuery` with cache keys that were bumped when changing data shape or RPCs (e.g. home scatter `v5`, playlists `v3`, collectors with override buster).

- **What to watch**  
  After deploying, users may see cached data until TTL expires (e.g. 1 hour). If you need everyone to see new behavior immediately after a release, consider shortening TTL for those keys temporarily or documenting that a hard refresh / waiting an hour may be needed.

---

## Quick reference

| Area              | Watch out for                                                                 |
|-------------------|-------------------------------------------------------------------------------|
| Partitioning      | Automated via `/api/cron/ensure-partitions` (Vercel Cron, 1st of month). Set CRON_SECRET in Vercel. See `docs/PARTITIONING-TRACK-DAILY-STREAMS.md`. |
| Collectors        | Weekly/Monthly/Quarterly/Yearly comparison chart = last 365 days only.       |
| Home scatter      | One large RPC; add pagination/cap if catalog grows a lot.                      |
| Playlists         | Latest track count requires at least one `playlist_daily_stats` row per playlist. |
| Health            | Many warnings → many parallel RPCs; monitor connections/timeouts.            |
| Charts            | Long ranges are downsampled to 400 points.                                    |
| Catalog lists     | 150 rows then “Show more”; “select all” type features must use full data.      |
| Images            | New image domains need `remotePatterns` in `next.config.ts`.                   |
| Caching           | Cache keys were bumped; allow for TTL after deploy.                           |
