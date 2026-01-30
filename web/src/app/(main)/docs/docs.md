# SpotiBase `/docs`

This is the canonical, **human + chatbot friendly** description of how SpotiBase works end-to-end.

**Primary goals**

- Be accurate to the code + database that exists today (avoid “hand-wavy docs”).
- Be “AI-updatable”: clear sections, explicit file pointers, and a changelog at the bottom.
- Make it easy to answer: “Where do I click for X?” and “Where is X implemented?”

> **Where to edit this document**
>
> - `web/src/app/(main)/docs/docs.md`
> - Renderer/UI: `web/src/app/(main)/docs/page.tsx` + `DocsClient.tsx`

---

## Quick “How do I…?” (user cookbook)

### Search for a track / artist / playlist

- Use the **search bar in the top header** (visible on most pages).
- Type at least 2 characters.
- Click result behavior:
  - **Track** → opens `/catalog?isrc=<ISRC>` (and may include `artist_id` if known)
  - **Artist** → opens `/catalog?artist_id=<spotify_artist_id>`
  - **Playlist** → opens `/playlists/<playlist_key>`
- The small number shown at the right of each result is the **latest total streams** for that entity (see `/api/search-stats`).

Implementation pointers:

- Search UI: `web/src/components/shell/SearchBar.tsx`
- Search API: `web/src/app/api/search/route.ts` (uses Postgres RPC `search_all`)
- Hover stats API: `web/src/app/api/search-stats/route.ts`

### View an artist’s total streams

You have 2 “truthy” ways to do this:

- **From Catalog**:
  - Open `/catalog?artist_id=<spotify_artist_id>`
  - The “cumulative” chart represents **total streams across all tracks for that artist**, per day (summed from per-track snapshots).
- **From Search hover stats**:
  - Search an artist
  - Hover the result; the stat is computed by `artist_total_streams_for_date(artist_id, latest_run_date)`

Implementation pointers:

- Catalog aggregates: `migrations/add_catalog_artist_aggregate_rpcs.sql`
- Search hover stats: `migrations/add_search_stats_aggregate_rpcs.sql`

### View a track’s total streams (and daily streams)

- Open `/catalog?isrc=<ISRC>`
- **Total/cumulative** is the snapshot value from `track_daily_streams.streams_cumulative`.
- **Daily** is derived as \( today\_cumulative - yesterday\_cumulative \) (clamped at 0 in some charts).

Shortcut:

- `/tracks/<ISRC>` redirects to `/catalog?isrc=<ISRC>`

### View a playlist’s performance (streams/revenue/track count)

- Open `/playlists`
- Select a playlist (or open directly `/playlists/<playlist_key>`)
- Use the range toggles (30/90/365) to change the time window

What you’re seeing:

- `playlist_daily_stats` supplies totals and daily deltas
- Membership drilldowns come from Postgres RPCs (top/added/removed tracks)

### Download/export data

- Catalog:
  - CSV download buttons on charts
  - Download “Top tracks” tables as CSV
- Collectors:
  - CSV download for charts and monthly aggregation
- Health:
  - Export missing catalog tracks list as CSV (button in the “All Missing Catalog Tracks” section)
  - Download raw export CSV files via signed links

---

## What SpotiBase is (in 60 seconds)

SpotiBase ingests **daily SpotOnTrack CSV exports** and turns them into a queryable analytics database + dashboards for:

- **Catalog analytics** (tracks, artists)
- **Operational playlists** (membership + performance)
- **Health/anomaly detection** (missing exports, track count swings, missing enrichment, etc.)

Repo overview:

- Exporter + ingestion scripts: `scripts/`
- DB migrations (run in Supabase SQL editor): `migrations/`
- Web app (Next.js App Router): `web/`

---

## Key concepts (glossary)

### Track identity (uniqueness)

- A **track is unique by ISRC** (`tracks.isrc`).
- Implications:
  - Same title across multiple releases: if ISRC matches → treated as the *same track*.
  - Same title but different ISRCs → treated as *different tracks*.

### Playlist identity

- Internal identifier: `playlist_key` (stable string).
- Optional Spotify identifiers are used for enrichment/outbound linking.

### Artist identity

- There is **no dedicated `artists` table** today.
- Artists are derived from arrays on tracks:
  - `tracks.spotify_artist_ids[]`
  - `tracks.spotify_artist_names[]`
- Artist pages and catalog filtering use **Spotify artist ID**.

### Run date vs data date (SpotOnTrack lag)

SpotOnTrack data is delayed. The app standardizes this:

- DB stores **run date** = ingestion snapshot date
- UI often displays **data date** = run date minus `SOT_DATA_LAG_DAYS`

Source of truth:

- `web/src/lib/sotDates.ts` (`SOT_DATA_LAG_DAYS = 2`)

### What is the “all_catalog” playlist?

`all_catalog` is a **virtual, derived playlist** representing your whole catalog set.

- It is computed daily by ingestion as:
  - `all_catalog = releases ∪ ext`
- It is used for:
  - Home “All Catalog” overview
  - “Latest run date” canonical reference in several places
  - A default starting point in playlists and other dashboards

Implementation pointers:

- Ingestion derivation: `scripts/ingest_exports_to_supabase.py`
- Several RPCs treat `all_catalog` as a union playlist (see `migrations/add_playlists_fast_tables_rpcs.sql` and enrichment/missing tracks RPCs).

---

## High-level architecture (end-to-end)

### Daily data flow

1) **Export**
   - GitHub Action exports CSVs to `exports/YYYY/MM/DD/<playlist_key>.csv`
2) **Ingest**
   - `scripts/ingest_exports_to_supabase.py` parses CSVs and writes to Supabase via PostgREST using the **service role** key
3) **Serve**
   - Next.js reads from Supabase
   - Heavy computations are done in Postgres via **RPCs** (fast + scalable)
4) **Enrich (Spotify)**
   - Track lookup by ISRC (for missing images)
   - Artist image caching table to avoid repeated Spotify API calls

### Web app layout

- `(auth)` segment: login (`/login`)
- `(main)` segment: authenticated pages + app shell
- `/api/*`: server-only API routes (Next)

---

## Security & access model (how auth + RLS works here)

<!-- tags: security, auth, rls, supabase -->
<!-- sources: web/src/app/(main)/layout.tsx, web/src/lib/supabase/server.ts, web/src/lib/supabase/service.ts, web/src/lib/supabase/client.ts -->

### The 3 Supabase clients (and when to use each)

- `supabaseBrowser()` (`web/src/lib/supabase/client.ts`)
  - Runs in the browser
  - Uses anon key + stores session in cookies/local storage (Supabase SSR helpers)
  - Used for login and client interactions

- `supabaseServer()` (`web/src/lib/supabase/server.ts`)
  - Runs on the Next.js server
  - Uses anon key + **request cookies**
  - Used for session checks, user identity, and any user-scoped reads

- `supabaseService()` (`web/src/lib/supabase/service.ts`)
  - Runs on the Next.js server
  - Uses the **service role key** (bypasses RLS)
  - Used for server-only reads/writes where RLS would be problematic (especially cached analytics)
  - Never shipped to the browser (no `NEXT_PUBLIC_` prefix)

### Why many pages use service role for cached reads

Next.js caching/revalidation can execute without the original request cookies.
If a cached query depends on cookie-auth, revalidation can fail and you’ll serve stale data.

So the pattern in `(main)` pages is:

1) Verify a real session exists (`supabaseServer().auth.getUser()`), otherwise redirect to `/login`
2) Verify admin capability (`sb.rpc("is_admin")`), otherwise redirect away
3) Read analytics using `supabaseService()` + `cachedQuery()`

### Environment variables (web app)

Defined in `web/env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SPOTIFY_CLIENT_ID` (server-only)
- `SPOTIFY_CLIENT_SECRET` (server-only)
- `REVALIDATE_SECRET` (server-only; used by revalidation endpoints if/when enabled)

### Environment variables (ingestion)

Used by `scripts/ingest_exports_to_supabase.py`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional:
  - `SUPABASE_STORAGE_BUCKET` (defaults to `spotibase-exports`)
  - `SUPABASE_STORAGE_PREFIX` (defaults to `exports`)

---

## What each page does (and everything you can do on it)

### Login (`/login`)

- Purpose: authenticate via Supabase Auth.
- What you can do:
  - Sign in with email/password
  - Redirect back to the originally requested page via `?next=...`

Files:

- `web/src/app/(auth)/login/page.tsx`
- `web/src/app/(auth)/login/ui.tsx`

### Home (`/`)

- Purpose: high-level overview of “All / Releases / Ext”.
- What you can do:
  - Toggle scope: `all_catalog` / `releases` / `ext`
  - Toggle range: 30 / 90 / 365 days
  - View quick KPIs and charts

Data:

- `playlist_daily_stats` (cached)

File:

- `web/src/app/(main)/page.tsx`

### Catalog (`/catalog`)

- Purpose: artist-first catalog analytics with optional track drilldown.
- What you can do:
  - Select an artist
  - Select a track within that artist
  - Switch metrics (streams vs revenue; track panels stay streams/revenue)
  - Download CSVs (charts + top track tables)
  - Change time range (30/90/365)

Important semantics:

- Artist series and “top tracks” are computed in Postgres RPCs.
- Track daily values are derived from cumulative snapshots.

Implementation pointers:

- Page (server): `web/src/app/(main)/catalog/page.tsx`
- UI (client): `web/src/app/(main)/catalog/CatalogPageClient.tsx`
- RPCs: `migrations/add_catalog_artist_aggregate_rpcs.sql`

### Playlists (`/playlists`)

- Purpose: playlist performance + membership drilldowns over time.
- What you can do:
  - Select a playlist
  - Change time range
  - View “top tracks” in the playlist
  - View “added” and “removed” tracks (membership changes)
  - Open playlist on Spotify (if enriched with Spotify playlist id)

Implementation pointers:

- Page: `web/src/app/(main)/playlists/page.tsx`
- Fast tables RPCs: `migrations/add_playlists_fast_tables_rpcs.sql`

### Collectors (`/collectors`)

Collectors are **groups of playlists** (think “collection buckets”) based on the `playlists.collector` column.

- Purpose:
  - Compare collectors to each other (daily revenue/streams/tracks)
  - Drill into a single collector’s series
  - See top playlists within that collector for the latest day
- What you can do:
  - Select a collector (`A`, `K`, `N`, `PL`, `TG`, `NL`)
  - Change date range (30/90/365) or pick a custom date range
  - Toggle metric: Revenue / Streams / Tracks
  - Download CSVs (daily/cumulative charts + monthly aggregation)

Data sources:

- `playlists.collector` (assignment of playlists to collectors)
- `collector_daily_agg` (time series aggregate table)
- `collector_daily_compare` (compare view/table for the latest day)
- `playlist_daily_stats` (top playlists within the selected collector for the latest date)

Where those collector tables come from:

- `migrations/add_collectors_aggregate_views.sql` creates the views:
  - `collector_daily_agg`
  - `collector_daily_compare`

Files:

- `web/src/app/(main)/collectors/page.tsx`
- `web/src/app/(main)/collectors/CollectorsClient.tsx`

### Health (`/health`)

- Purpose:
  - Show ingestion runs (last ~30)
  - Show warnings for selected date (critical/warn/info)
  - Provide drilldowns to understand exactly what broke and how to fix it
- What you can do:
  - Filter warnings by severity and playlist
  - Expand warnings to see impacted tracks (for supported warning types)
  - Export “missing catalog tracks” list
  - Download raw export CSVs for the selected run date

Core warning types you’ll see:

| Code | What it means | Typical fix |
|---|---|---|
| `missing_export` | Expected daily CSV not present | Fix exporter / SpotOnTrack dashboard config |
| `zero_row_export` | CSV exists but has 0 rows | Investigate export failure or wrong dashboard |
| `min_rows_failed` | Safety: export too small, ingestion aborted | Increase dashboard stability / adjust `min_rows` after verifying reality |
| `track_count_swing` | Track count changed too much vs yesterday | Expand to see added/removed; validate export integrity |
| `track_count_swing_hard_fail` | Safety: huge catalog swing, ingestion aborted | Almost always partial export; fix exporter |
| `non_catalog_tracks_present` | Playlist contains tracks not in catalog snapshot that day | Add exclusions if intentional or fix catalog export/enrichment |
| `tracks_missing_enrichment` | Tracks missing Spotify enrichment (`spotify_artist_ids` is null) | Run enrichment workflow to populate metadata |

Implementation pointers:

- Page: `web/src/app/(main)/health/page.tsx`
- Expandable row UI: `web/src/components/health/WarningRow.tsx`
- Health summary API (polling): `web/src/app/api/health-summary/route.ts`
- Health RPCs:
  - `migrations/add_health_missing_catalog_rpcs.sql`
  - `migrations/add_health_track_count_swing_rpc.sql`
  - `migrations/add_health_missing_enrichment_tracks_rpc.sql`

### Settings (`/settings`)

- Purpose: operational controls (e.g., excluding intentional “non-catalog” tracks from warnings).
- What you can do:
  - Add/remove track exclusions for health calculations

Files:

- `web/src/app/(main)/settings/page.tsx`
- `web/src/app/(main)/settings/TrackExclusionForm.tsx`

---

## Data model (Supabase/Postgres): the important parts

> This is intentionally “conceptual” and focused on how the app uses the data. Check Supabase schema for exact columns.

### Tables you should know

- `tracks`
  - One row per ISRC (primary track identity)
  - Spotify enrichment fields live here (artist ids/names, album image, track id)
- `track_daily_streams`
  - One row per (run_date, isrc) with a **cumulative snapshot**
  - Daily deltas are derived by differences across days
- `playlists`
  - One row per `playlist_key` (display name, types, optional Spotify playlist data, optional `collector`)
- `playlist_memberships`
  - Time-travel membership (`valid_from`, `valid_to`)
- `playlist_daily_stats`
  - One row per (run_date, playlist_key) containing precomputed totals/daily deltas
- `ingestion_runs`, `raw_exports`, `ingestion_warnings`
  - Operational metadata and diagnostics
- `health_warning_exclusions`
  - Suppresses intentional “non-catalog tracks” warnings (global or per-playlist)
- `spotify_artist_images`
  - Cache table for artist images (reduces Spotify API calls)

---

## Data dictionary (fields used by the app)

<!-- tags: schema, data-dictionary, tables -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main)/*, migrations/*.sql -->

This is a **practical schema snapshot**: it lists the fields that the current app code relies on most.
Your DB may have additional columns; those are fine.

### `tracks` (one row per ISRC)

| Field | Type (typical) | Meaning / usage |
|---|---|---|
| `isrc` | text (PK) | Track identity in SpotiBase |
| `name` | text | Track title (from export / enrichment) |
| `release_date` | date/text | Release date from export when available |
| `first_seen` | date | First ingestion date this ISRC appeared |
| `last_seen` | date | Last ingestion date this ISRC appeared |
| `spotify_track_id` | text | Spotify track id (if enriched) |
| `spotify_album_image_url` | text | Album artwork URL used by UI tables |
| `spotify_artist_ids` | text[] | Spotify artist ids (array) |
| `spotify_artist_names` | text[] | Spotify artist names (array, aligned with ids) |

### `track_daily_streams` (one row per run date × ISRC)

| Field | Type | Meaning / usage |
|---|---|---|
| `date` | date | Run date (ingestion snapshot date) |
| `isrc` | text | Track identity |
| `streams_cumulative` | bigint/int | Cumulative streams snapshot for that run date |
| `source_run_id` | uuid/text | Links to `ingestion_runs.id` (provenance) |

### `playlists` (one row per playlist_key)

| Field | Type | Meaning / usage |
|---|---|---|
| `playlist_key` | text (PK) | Stable internal playlist identifier |
| `display_name` | text | Name shown in UI |
| `is_catalog` | boolean | Marks “catalog exports” vs operational playlists |
| `playlist_type` | text/null | Optional classification |
| `dashboard_url` | text/null | SpotOnTrack dashboard URL (pipeline config) |
| `collector` | text/null | Assigns playlist to a “collector” bucket (Collectors page) |
| `display_order` | int/null | Optional ordering in UI |
| `spotify_playlist_id` | text/null | For outbound link to Spotify |
| `spotify_playlist_image_url` | text/null | For cover image in UI |
| `spotify_last_fetched_at` | timestamptz/null | Last playlist enrichment time |

### `playlist_memberships` (time-travel membership)

| Field | Type | Meaning / usage |
|---|---|---|
| `id` | uuid/int | Internal row id |
| `playlist_key` | text | Which playlist |
| `isrc` | text | Which track |
| `valid_from` | date | First day the track is considered active in this playlist |
| `valid_to` | date/null | Last day active; null = still active |

### `playlist_daily_stats` (playlist metrics snapshot per day)

| Field | Type | Meaning / usage |
|---|---|---|
| `date` | date | Run date |
| `playlist_key` | text | Playlist |
| `track_count` | bigint/int | Number of active tracks that day |
| `total_streams_cumulative` | bigint/int | Sum of cumulative streams across tracks (catalog snapshot join) |
| `daily_streams_net` | bigint/int/null | Day-over-day delta of total streams (derived) |
| `missing_streams_track_count` | bigint/int | Tracks in playlist missing catalog snapshot that day |
| `est_revenue_total` | numeric | Estimated total revenue (`streams * 0.002`) |
| `est_revenue_daily_net` | numeric/null | Estimated daily revenue |
| `source_run_id` | uuid/text | Link to ingestion run |

### `ingestion_runs` (one row per run date)

| Field | Type | Meaning / usage |
|---|---|---|
| `id` | uuid/text | Run id |
| `run_date` | date | Run date |
| `status` | text | `running` / `success` / `failed` |
| `started_at` | timestamptz/null | Timing |
| `finished_at` | timestamptz/null | Timing |
| `commit_sha` | text/null | Git SHA from CI (if set) |
| `logs_url` | text/null | Link to GitHub Actions run |
| `exports_prefix` | text/null | Storage prefix for exported CSVs |

### `raw_exports` (CSV metadata per run)

| Field | Type | Meaning / usage |
|---|---|---|
| `run_id` | uuid/text | Links to `ingestion_runs.id` |
| `playlist_key` | text | Which export |
| `object_key` | text | Storage path to CSV |
| `storage_bucket` | text | Storage bucket |
| `storage_prefix` | text | Storage prefix |
| `rows_count` | int | Row count in export |
| `file_sha256` | text | Hash for integrity/debugging |
| `exported_at` | timestamptz | Timestamp of export record |

### `ingestion_warnings` (diagnostics)

| Field | Type | Meaning / usage |
|---|---|---|
| `run_id` | uuid/text | Links to `ingestion_runs.id` |
| `run_date` | date | Run date |
| `playlist_key` | text/null | Playlist scope; null = global |
| `severity` | text | `critical` / `warn` / `info` |
| `code` | text | Machine-friendly identifier (see catalog below) |
| `message` | text | Human summary |
| `details_json` | jsonb | Structured payload for UI drilldowns |

### `health_warning_exclusions` (intentional suppressions)

| Field | Type | Meaning / usage |
|---|---|---|
| `id` | uuid/int | Row id |
| `code` | text | Warning code being suppressed (today: `non_catalog_tracks_present`) |
| `playlist_key` | text/null | Null = global exclusion; else per-playlist |
| `isrc` | text | Track to exclude |
| `created_at` | timestamptz | Audit |

### `spotify_artist_images` (artist image cache)

| Field | Type | Meaning / usage |
|---|---|---|
| `artist_id` | text (PK) | Spotify artist id |
| `name` | text/null | Artist name |
| `image_url` | text/null | Cached image |
| `external_url` | text/null | Spotify URL |
| `refreshed_at` | timestamptz | Cache staleness control |

---

## Warning code catalog (ingestion_warnings.code)

<!-- tags: health, warnings, ingestion -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main)/health/page.tsx, web/src/components/health/WarningRow.tsx -->

These are the warning codes emitted by the ingestion script today:

| Code | Severity | Meaning | Where it comes from | Fix / next step |
|---|---|---|---|---|
| `missing_export` | critical | Expected CSV file is missing | ingestion script checks `exports/YYYY/MM/DD/<playlist_key>.csv` exists | Fix exporter/config; re-run export; confirm playlist_key matches |
| `zero_row_export` | critical | CSV exists but has 0 rows | ingestion script `count_csv_rows` | Investigate SpotOnTrack export page; often partial load or auth/session issues |
| `min_rows_failed` | critical | Configured minimum row threshold failed; ingestion aborted to protect integrity | ingestion script checks `Playlist.min_rows` | Fix exporter stability; only lower min_rows after confirming expected row counts |
| `track_count_swing_hard_fail` | critical | Catalog playlist changed by ≥70% vs previous day; ingestion aborted | ingestion hard safety for catalog playlists | This usually means partial export; fix exporter/run again |
| `track_count_swing` | warn/critical | Track count swing vs yesterday (warn), or catalog count dropped by > threshold (critical) | ingestion compares `playlist_daily_stats` day-over-day | Expand warning in UI to see changes; validate exports |
| `high_zero_stream_rate` | warn | Catalog export has too many rows with 0 streams | ingestion computes zero-stream ratio for catalog playlists | Investigate SpotOnTrack data freshness; ensure correct dashboard/export format |
| `non_catalog_tracks_present` | critical | Playlist contains tracks not present in catalog snapshot for that day | ingestion compares playlist ISRC set vs `track_daily_streams` ISRCs | If intentional: add exclusions in Settings; else fix catalog export/enrichment |
| `tracks_missing_enrichment` | info | Tracks missing Spotify enrichment (no artist ids) | ingestion checks `tracks.spotify_artist_ids IS NULL` | Run Spotify enrichment to fill metadata |
| `ingestion_exception` | critical | Script threw an exception (catch-all) | ingestion exception handler | Open run logs URL; fix root cause; rerun |

Notes:

- The Health UI also runs “drilldown” RPCs so you can expand some warnings to see impacted tracks.
- Exclusions apply primarily to `non_catalog_tracks_present`.

---

## API routes (Next.js)

- `/api/search`
  - unified search via Postgres RPC `search_all(q, max_results)`
  - hydrates artist images using DB cache `spotify_artist_images`
- `/api/search-stats`
  - hover stats using:
    - `track_daily_streams` (track)
    - `artist_total_streams_for_date` (artist)
    - `playlist_total_streams_for_date` (playlist)
- `/api/health-summary`
  - lightweight polling payload for header banner
- `/api/breadcrumb/artist`, `/api/breadcrumb/track`
  - dynamic labels for breadcrumbs
- `/api/spotify-track`
  - best-effort Spotify lookup by ISRC (for album image)
- `/api/spotify-track-batch`
  - batch Spotify lookup by ISRC (bounded to 50 ISRCs, concurrency-limited)

Files live under:

- `web/src/app/api/*`

---

## Postgres RPCs (Supabase): why they exist and what they do

SpotiBase pushes “heavy computations” into Postgres for:

- fewer roundtrips
- correct, index-aware joins
- stable performance as tables grow
- smaller payloads to the UI

Key RPC sets:

- Search: `migrations/add_search_all_rpc.sql`
- Catalog artist aggregates: `migrations/add_catalog_artist_aggregate_rpcs.sql`
- Playlists heavy tables: `migrations/add_playlists_fast_tables_rpcs.sql`
- Health drilldowns:
  - `migrations/add_health_missing_catalog_rpcs.sql`
  - `migrations/add_health_track_count_swing_rpc.sql`
  - `migrations/add_health_missing_enrichment_tracks_rpc.sql`
- Search hover stats: `migrations/add_search_stats_aggregate_rpcs.sql`
- System stats (Docs): `migrations/add_spotibase_system_stats_rpc.sql`

---

## Migrations checklist (what must be applied in Supabase)

<!-- tags: migrations, database, setup -->
<!-- sources: migrations/*.sql -->

If a feature is acting “weird”, the first thing to verify is whether the required SQL migrations have been applied in your Supabase project.

### Required (core)

- `migrations/add_search_all_rpc.sql`
  - Enables the unified search RPC (`search_all`) and trigram indexes.
  - Without it: `/api/search` will fail or return empty results.

- `migrations/add_search_stats_aggregate_rpcs.sql`
  - Enables hover stats RPCs for artist/playlist totals.
  - Without it: search hover numbers will be missing/incorrect.

- `migrations/add_catalog_artist_aggregate_rpcs.sql`
  - Enables fast artist aggregates for `/catalog`.
  - Without it: catalog will fall back to slow patterns or error when calling missing RPCs.

- `migrations/add_playlists_fast_tables_rpcs.sql`
  - Enables fast playlist membership tables for `/playlists`.
  - Without it: playlist drilldowns (top/added/removed) will be missing/slow.

### Health drilldowns (recommended)

- `migrations/add_health_missing_catalog_rpcs.sql`
- `migrations/add_health_track_count_swing_rpc.sql`
- `migrations/add_health_missing_enrichment_tracks_rpc.sql`

Without these: `/health` can still show the warning rows, but expansions/drilldowns may be missing or slow.

### Ingestion banner + health counts (recommended)

- `migrations/add_ingestion_read_policies.sql`

Without it (when GRANT/RLS policies are missing): the site-wide ingestion banner may show `Data ingestion status: unknown`, and warning counts/badges may be missing.

### Collectors

- `migrations/add_collectors_aggregate_views.sql`

Without it: `/collectors` will error when querying `collector_daily_agg` / `collector_daily_compare`.

### Optional (docs/system)

- `migrations/add_spotibase_system_stats_rpc.sql`
  - Enables `/docs` to display live system sizing stats (tracks/playlists/artists/etc).
  - Without it: the `/docs` stats box will show partial values.

---

## Performance, scale, and “how much can it handle?”

This section is intentionally **honest**: it describes what the current design *should* handle reliably, and what will become the bottleneck first.

### What grows the fastest

- `track_daily_streams` grows as:
  - \( \text{tracks} \times \text{days} \)
  - Example: 10,000 tracks × 365 days ≈ **3.65M rows**
- `playlist_memberships` grows with playlist churn over time (adds + removals accumulate).

### Current “safe” scale (rule-of-thumb)

These are conservative, based on:

- existing index + RPC patterns in `migrations/`
- the fact that search RPC is explicitly designed for “~10k rows” scale
- deliberate UI-side limits (bounded result sizes)

- **Tracks (`tracks`)**: ~10k is “comfortably intended” today; ~50k may still work but search and joins will start to need more indexing/materialization.
- **Daily snapshots (`track_daily_streams`)**: a few million rows should be workable on a typical Supabase Postgres instance *if indexes exist*; tens of millions is where you’ll want stronger DB sizing and/or partitioning/materialized aggregates.
- **Playlists (`playlists`)**: hundreds is fine; thousands is still reasonable but you’ll want to watch the “top playlists” and membership computations.
- **Artists (derived)**: roughly proportional to tracks; the costly part is not counting artists but joining to snapshots.

### Built-in “limits” in the current code (important for reliability)

- Catalog:
  - Recent tracks used to derive artist dropdown: ~2000 rows (`catalog/page.tsx`)
  - Track list per artist: capped at 800 rows
  - Track series fetch: capped (`maxRows`) when pulling per-track time series
- Search:
  - Returns up to ~40 results per query
  - Artist image hydration only for top ~20 artists per query

These are intentional guardrails to prevent the UI from trying to load “the entire database” at once.

### If you outgrow the current scale, the next upgrades are

- Add/verify indexes in migrations (especially GIN/trgm and snapshot date/isrc composite indexes).
- Push more work into Postgres (RPCs/materialized views) so the app never scans large tables.
- Consider partitioning `track_daily_streams` by date once it reaches tens of millions of rows.
- Cache “hot paths” with run-date keyed cache keys (already used in search).

---

## Debugging (practical playbook)

### “Why is the date off by 2 days?”

- You’re looking at **data date**, but the DB stores **run date**.
- SpotOnTrack lag is defined in `web/src/lib/sotDates.ts`.

### “Why does Health show non-catalog tracks?”

- The playlist membership contains ISRCs that do **not** exist in `track_daily_streams` for that run date.
- If intentional, add exclusions in `health_warning_exclusions` with code `non_catalog_tracks_present`.

### “Why is search missing images?”

- Artist images are hydrated through the DB cache table `spotify_artist_images`.
- If missing/stale, they refresh on-demand (best-effort) or via the refresh script.

---

## Operations runbook (copy/paste friendly)

<!-- tags: ops, runbook, troubleshooting -->

### “I want to confirm today’s ingestion succeeded”

- Go to `/health`
- Look at the latest run in “Ingestion Runs”
- If `status != success`, open the `logs_url` for the failing run

### “I want the raw CSV that was ingested”

- Go to `/health`
- In “Raw Exports”, click the `csv` link for the playlist key you want
- If the link is missing, confirm `raw_exports` rows exist for that `run_id`

### “Health shows non-catalog tracks; I know they’re intentional”

- Go to `/settings`
- Add exclusions for the ISRC(s) under the `non_catalog_tracks_present` code
- Re-check `/health` (the UI also hides warnings that are fully excluded)

### “Search feels slow or incomplete”

Checklist:

- Confirm search migration exists/applied:
  - `migrations/add_search_all_rpc.sql` (trigram + `search_all`)
- Confirm stats migration exists/applied:
  - `migrations/add_search_stats_aggregate_rpcs.sql`
- Confirm artist cache table exists:
  - `migrations/add_spotify_artist_image_cache.sql`
- If images are missing:
  - run `web/scripts/refresh_spotify_artist_images.mjs` (or let on-demand refresh fill hot entries)

### “Numbers don’t match Spotify”

- Remember:
  - SpotiBase uses SpotOnTrack exports (lagged)
  - UI shows **data date** (run date minus 2 days)
  - Tables store cumulative snapshots; daily is derived by difference

---

## Collectors admin guide (how to maintain collectors)

<!-- tags: collectors, admin, playlists -->
<!-- sources: web/src/app/(main)/collectors/page.tsx, migrations/add_collectors_aggregate_views.sql -->

### What a collector is (in this codebase)

- A “collector” is a **label on playlists** (`playlists.collector`)
- The Collectors page aggregates playlist metrics by that label

### How collector metrics are computed

- Views are created in `migrations/add_collectors_aggregate_views.sql`:
  - `collector_daily_agg`: sums `playlist_daily_stats` across all playlists assigned to a collector, per day
  - `collector_daily_compare`: adds window comparisons (yesterday delta, delta vs previous 7-day average)

### How to add/remove playlists from a collector

- Update the playlist row in `playlists`:
  - set `collector` to one of the supported codes (today: `A`, `K`, `N`, `PL`, `TG`, `NL`)
  - set it to null to exclude it from collectors

### What happens if a playlist has no collector?

- It will still appear on `/playlists`
- It will **not** be included in collector aggregates (views filter `collector IS NOT NULL`)

---

## Extending the system safely (how to add features without slowing it down)

- Prefer adding Postgres RPCs (with indexes) over client-side scanning.
- Keep ingestion idempotent per run date.
- Emit structured warning details (`details_json`) when you add new warning types.
- Update this doc in 3 places:
  - “What each page does”
  - “Data model”
  - “Debugging” + “Performance/scale”

---

## Chatbot notes (future integration)

### Canonical facts the bot should learn

- Track identity is ISRC.
- Artist identity is Spotify artist id; artists are derived from track arrays (no artists table).
- Snapshot tables store cumulative values; daily deltas are derived.
- `all_catalog` is a union/virtual playlist used as the canonical “whole catalog” lens.
- SpotOnTrack lag: `SOT_DATA_LAG_DAYS = 2` (UI shifts dates).

### Question → where the answer lives

- “How do I find a track?” → Search bar → `/api/search` → `search_all`
- “Artist total streams today?” → `/api/search-stats` → `artist_total_streams_for_date`
- “Top tracks for artist X?” → Catalog RPCs (`catalog_artist_top_tracks_daily/total`)
- “Why is health warning present?” → `ingestion_warnings` + relevant health RPC for drilldown
- “What changed in playlist Y?” → playlist/health membership RPCs (`playlist_added_tracks`, `playlist_removed_tracks`, `health_track_count_swing_tracks`)

---

## FAQ (common questions)

<!-- tags: faq, glossary -->

### Is a track unique by ISRC?

Yes. In SpotiBase, **ISRC is the primary track identity** (`tracks.isrc` and joins to `track_daily_streams.isrc`).

### What is the difference between Spotify track id and ISRC?

- Spotify track id: identifies a specific Spotify track object (can vary by territory/duplicate uploads).
- ISRC: the industry recording identifier; more stable across releases and systems.

SpotiBase uses ISRC because SpotOnTrack exports are ISRC-based and it’s the best stable join key.

### Why do dates look “2 days behind”?

SpotOnTrack has a known lag; UI displays “data date” by shifting run date by `SOT_DATA_LAG_DAYS=2`.

### Why are some daily values zero or missing?

Common causes:

- First day of ingestion (no previous day to diff against)
- Missing export / partial export (check Health)
- Track not present in catalog snapshot for the day (non-catalog track warnings)

### Can SAI (SpotiBase Artificial Intelligence) read these docs later?

Yes—best practice is:

- Treat `docs.md` as a source-of-truth corpus
- Chunk by `##` sections (already how `/docs` UI is structured)
- Index chunks (embeddings + metadata: tags/sources)
- Retrieve relevant chunks at question time (RAG)

This keeps SAI grounded in the actual system behavior and avoids hallucinating.

---

## SAI ingestion spec (recommended format for RAG)

<!-- tags: sai, chatbot, rag -->

If you build “SAI” later, the easiest reliable approach is **RAG (retrieval augmented generation)**.

### Recommended ingestion source(s)

- Primary: `web/src/app/(main)/docs/docs.md`
- Secondary:
  - `scripts/ingest_exports_to_supabase.py` (warning meanings + ingestion logic)
  - `migrations/*.sql` (RPC definitions + performance indexes)

### Chunking rules

- Chunk by `##` section boundaries (already how `/docs` UI splits content).
- Keep each chunk:
  - title
  - body markdown
  - tags (from `<!-- tags: ... -->`)
  - sources (from `<!-- sources: ... -->`)

### Retrieval rules (practical)

- Always retrieve:
  - at least 1 “page behavior” chunk (how to do X)
  - at least 1 “data model/RPC” chunk (where the numbers come from)
  - at least 1 “debugging/runbook” chunk when the user asks “why” or “error”

### Answer policy

- If a question is about numbers, SAI should:
  - state which table/RPC defines the number
  - state run date vs data date assumptions
  - warn when the answer is an estimate (e.g. track_daily_streams reltuples estimate)

---

## KPI & metric definitions (exact meaning of numbers you see)

<!-- tags: kpis, metrics, semantics -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main)/page.tsx, web/src/app/(main)/playlists/page.tsx, web/src/app/(main)/catalog/page.tsx, web/src/app/(main)/collectors/page.tsx -->

This section defines the “official meaning” of the most important metrics shown in the UI.

### Track-level

| KPI/Label | Definition | Source |
|---|---|---|
| Track total streams | `track_daily_streams.streams_cumulative` for the selected run date | `track_daily_streams` |
| Track daily streams | `today(streams_cumulative) - yesterday(streams_cumulative)` (when both exist); some views clamp at 0 | derived |
| Track revenue (est.) | `streams * 0.002` | constant in ingestion/UI |

### Playlist-level (`playlist_daily_stats`)

| KPI/Label | Definition | Notes |
|---|---|---|
| Tracks | `track_count` | active membership size on that day |
| Total streams | `total_streams_cumulative` | sum of cumulative streams across tracks (using catalog snapshot) |
| Daily streams (net) | `daily_streams_net` | day-over-day delta of `total_streams_cumulative` |
| Missing streams tracks | `missing_streams_track_count` | membership tracks missing from catalog snapshot that day (after exclusions) |
| Revenue (daily/total) | `est_revenue_daily_net` / `est_revenue_total` | estimated with payout constant |

### Catalog (artist aggregates)

| KPI/Label | Definition | Source |
|---|---|---|
| Artist total streams (series) | sum of `track_daily_streams.streams_cumulative` across tracks where `spotify_artist_ids` contains the artist id | `catalog_artist_series` RPC |
| Top tracks (daily) | ranked by per-day delta (run date vs run date-1) | `catalog_artist_top_tracks_daily` RPC |
| Top tracks (total) | ranked by cumulative streams on run date | `catalog_artist_top_tracks_total` RPC |

### Collectors

| KPI/Label | Definition | Source |
|---|---|---|
| Collector aggregates | sums across all playlists assigned to a collector per day | `collector_daily_agg` view |
| Collector compare deltas | yesterday delta and vs previous 7-day average | `collector_daily_compare` view |

---

## UI label → KPI dictionary (exact on-screen text mapping)

<!-- tags: kpis, ui, reference -->
<!-- sources: web/src/app/(main)/page.tsx, web/src/app/(main)/playlists/PlaylistMetricsClient.tsx, web/src/app/(main)/collectors/CollectorsClient.tsx, web/src/app/(main)/health/page.tsx -->

Use this when you (or SAI) want to map what you see on screen to the canonical definition.

### Home (`/`)

| UI label | Meaning |
|---|---|
| `Revenue (Daily)` | `est_revenue_daily_net` for the selected scope/playlist (or derived from daily streams × payout constant) |
| `Streams (7d)` | sum of last 7 days of `daily_streams_net` (requires ≥2 valid daily points to display) |
| `Streams (30d)` | sum of last 30 days of `daily_streams_net` (requires ≥2 valid daily points) |
| Recent History: `Tracks` | `track_count` |
| Recent History: `Total Streams` | `total_streams_cumulative` |
| Recent History: `Daily` | `daily_streams_net` |

### Playlists (`/playlists`)

| UI label | Meaning |
|---|---|
| `Total streams` | `playlist_daily_stats.total_streams_cumulative` |
| `Daily streams` | `playlist_daily_stats.daily_streams_net` |
| `Est. revenue (cumulative)` | `playlist_daily_stats.est_revenue_total` |
| `Est. revenue (daily)` | `playlist_daily_stats.est_revenue_daily_net` |
| `Track count` | `playlist_daily_stats.track_count` |
| `Track change (daily)` | `today(track_count) - yesterday(track_count)` (can be negative) |
| `Track count over time` | chart of `track_count` snapshots over the chosen range |

### Collectors (`/collectors`)

| UI label | Meaning |
|---|---|
| `Est. revenue (daily)` | `collector_daily_agg.est_revenue_daily_net` for selected collector/day |
| `Est. revenue (total)` | `collector_daily_agg.est_revenue_total` |
| `Daily streams` | `collector_daily_agg.daily_streams_net` |
| `Total streams` | `collector_daily_agg.total_streams_cumulative` |
| Compare table: `Yesterday` | value minus `*_delta_yday` (yesterday reconstructed) |
| Compare table: `7d avg` | value minus `*_delta_ma7` (previous 7-day avg reconstructed) |

### Health (`/health`)

| UI label | Meaning |
|---|---|
| `Warnings` | rows from `ingestion_warnings` filtered by date/severity/playlist |
| Table: `Severity` | `ingestion_warnings.severity` |
| Table: `Code` | `ingestion_warnings.code` |
| Table: `Playlist` | `ingestion_warnings.playlist_key` (nullable) |
| Table: `Message` | `ingestion_warnings.message` |
| `All Missing Catalog Tracks` | output of `health_missing_catalog_tracks(run_date)` |
| `Ingestion Runs (30d)` | last 30 rows from `ingestion_runs` |
| `Raw Exports` | rows from `raw_exports` for the selected run |

---

## Data contracts / invariants (things that should always be true)

<!-- tags: contracts, invariants, correctness -->
<!-- sources: scripts/ingest_exports_to_supabase.py, migrations/*.sql -->

These are “system rules” that future changes should preserve unless you intentionally redesign.

### Identity & joins

- `tracks.isrc` is the primary track identity (unique key).
- `track_daily_streams.isrc` joins to `tracks.isrc`.
- `playlist_memberships` references tracks by ISRC (not Spotify track id).

### Snapshot semantics

- `track_daily_streams.streams_cumulative` is a **cumulative snapshot**, not a delta.
- “Daily streams” are derived by difference of cumulative snapshots between adjacent days.

### Membership semantics

- `playlist_memberships.valid_to IS NULL` means the track is currently active in that playlist.
- A membership is active on date D if:
  - `valid_from <= D` and (`valid_to IS NULL` or `valid_to >= D`)

### all_catalog semantics

- `all_catalog` is virtual and derived as `releases ∪ ext` (unless explicitly changed).
- If you change the definition, update:
  - ingestion derivation
  - any RPCs that special-case `all_catalog`
  - the docs + KPI semantics

### Health exclusion semantics

- `health_warning_exclusions` only suppresses the warning code it’s associated with.
- Today it primarily affects `non_catalog_tracks_present` and “missing catalog tracks” lists.

---

## Data freshness & “what is the latest day?”

<!-- tags: freshness, dates, lag -->
<!-- sources: web/src/lib/sotDates.ts, web/src/app/(main)/health/page.tsx, web/src/app/(main)/page.tsx, web/src/app/api/search-stats/route.ts -->

### SpotOnTrack lag (run date vs data date)

- DB columns use **run dates** (ingestion snapshot dates).
- UI frequently shows **data dates** by shifting `SOT_DATA_LAG_DAYS` (currently 2 days).

### “Latest day” used in different places

- Home: newest `playlist_daily_stats.date` for the selected playlist_key
- Catalog: often treats newest `playlist_daily_stats.date` for `all_catalog` as canonical
- Search stats: uses newest `playlist_daily_stats.date` for `all_catalog` as `latestRunDate`
- Health: newest `ingestion_runs.run_date`

If these disagree, likely causes:

- ingestion succeeded but stats didn’t populate (or vice versa)
- partial ingestion for a date
- multiple pipelines writing different subsets

---

## Index & performance checklist (what to verify when scaling)

<!-- tags: performance, indexes, database -->
<!-- sources: migrations/add_search_all_rpc.sql, migrations/add_search_stats_aggregate_rpcs.sql, migrations/add_catalog_artist_aggregate_rpcs.sql, migrations/add_playlists_fast_tables_rpcs.sql -->

When performance regresses, it’s usually one of:

- missing index
- an unbounded query (no limit/range/date filters)
- doing aggregation in JS instead of Postgres

### Must-have indexes (current migrations)

- Search: trigram GIN indexes on names (`add_search_all_rpc.sql`)
- Artist contains filter: GIN on `tracks.spotify_artist_ids`
- Snapshot lookups: composite indexes on `track_daily_streams`
- Membership: partial indexes for current/removed memberships

### First table to outgrow

`track_daily_streams` tends to dominate growth.

If it reaches “tens of millions” of rows:

- partition by date
- ensure all heavy queries are date-bounded
- add materialized aggregates (artist/playlist rollups per day)

---

## Backup / recovery & “bad data” playbook

<!-- tags: recovery, ops, ingestion -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main)/health/page.tsx -->

### If ingestion wrote bad data for a day

Recommended approach:

1) Identify the run date (`/health` → ingestion runs).
2) Inspect raw exports for that run date (download CSVs).
3) Fix exporter/config.
4) Re-run ingestion idempotently for the same run date.

Notes:

- Ingestion is designed to be re-runnable for a run date:
  - it upserts config + stats
  - it clears stale warnings for an existing run id

### If you need rollback

Only do this with a deliberate plan:

- delete rows for the target `run_date` in affected tables (`track_daily_streams`, `playlist_daily_stats`, and any run-scoped tables)
- re-run ingestion

---

## Schema change protocol (for future you + AI agents)

<!-- tags: protocol, migrations, maintainability -->

When adding a feature that touches data:

- **Database**
  - add a migration (`migrations/*.sql`)
  - add indexes before heavy RPC logic
- **Web**
  - prefer RPCs for heavy queries
  - keep reads bounded (limit/range/date filters)
- **Docs**
  - update:
    - Data dictionary rows
    - KPI definitions
    - Migrations checklist
    - Debugging/runbooks
  - add `<!-- tags: ... -->` and `<!-- sources: ... -->` where appropriate

---

## Adding a new playlist/dashboard (playlist_key playbook)

<!-- tags: playlists, pipeline, ops -->
<!-- sources: scripts/ingest_exports_to_supabase.py, config/playlists.csv -->

### Steps

1) Add row to `config/playlists.csv`:
   - `playlist_key` (stable)
   - `display_name`
   - `is_catalog`
   - `dashboard_url`
   - optional `min_rows` (recommended)
2) Export and confirm CSV exists:
   - `exports/YYYY/MM/DD/<playlist_key>.csv`
3) Run ingestion for that day.
4) Verify:
   - `/health` shows the raw export row
   - `/playlists` includes the playlist
   - `playlist_daily_stats` has rows for it

### Interaction with `all_catalog`

`all_catalog` is derived as `releases ∪ ext` today.

Adding a new playlist_key does not automatically affect `all_catalog`.
Changing what “whole catalog” means requires updating ingestion logic + any RPCs that treat `all_catalog` specially.

---

## SAI answer templates (for consistent chatbot responses)

<!-- tags: sai, chatbot, answers -->

If you want SAI to be reliable, enforce answer structure.

### Template: “What does metric X mean?”

- **Definition** (1 sentence)
- **Where it comes from** (table/RPC/column)
- **Date semantics** (run date vs data date)
- **Edge cases** (day 1, missing yesterday, missing snapshot, exclusions)
- **How to verify in UI** (page + click path)

### Template: “Why is number X wrong?”

- **Most likely causes** (ordered)
- **How to confirm** (tables/pages to check)
- **Fix** (what to run/change)
- **Prevent recurrence** (min_rows, indexes, guardrails)

### Template: “How do I do X in the app?”

- **Path** (URL / nav path)
- **Steps** (3–6 bullets)
- **Data impact** (tables/RPCs touched/read)

---

## SAI security constraints (non-negotiable)

<!-- tags: sai, security -->

If/when SAI has access to your environment:

- Never expose secrets (`SUPABASE_SERVICE_ROLE_KEY`, Spotify secrets, cookies).
- Never allow writes unless explicitly authorized (avoid arbitrary SQL execution).
- Prefer “read-only + explain + point to sources”.

---

## Query param & URL reference (quick lookup)

<!-- tags: urls, reference -->
<!-- sources: web/src/app/(main)/catalog/page.tsx, web/src/app/(main)/playlists/page.tsx, web/src/app/(main)/collectors/page.tsx, web/src/components/shell/SearchBar.tsx, web/src/app/(main)/health/page.tsx -->

| Page | Key params | Meaning |
|---|---|---|
| `/catalog` | `artist_id`, `isrc`, `range` | choose artist/track and range window |
| `/playlists` | `playlist_key`, `range` | choose playlist and range window |
| `/collectors` | `collector`, `range`, `start`, `end` | choose collector and time window (custom date range supported) |
| `/health` | `severity`, `playlist`, `date` | filter warnings and select data date |
| `/login` | `next` | redirect destination after login |

---

## Observability & monitoring (recommended)

<!-- tags: monitoring, performance -->

As the dataset grows, you’ll want to be able to answer:

- Which pages/queries got slow?
- Did ingestion finish on time?
- Did we miss exports today?

Suggested lightweight additions:

- Enable timing logs for cached queries when debugging:
  - `SB_TIMING=true` and optionally `SB_TIMING_SLOW_MS=250`
- Add a daily “ingestion SLA” check:
  - expected latest run date vs actual latest run date
  - alert when stale beyond lag tolerance

---

## Changelog

- 2026-01-31: Added `/docs` page + initial architecture docs.
- 2026-01-31: Added cookbook, per-page actions, collectors definition, scale guidance, and docs search/collapse UI.
 - 2026-01-31: Added security/access model, data dictionary, warning catalog, ops runbook, collectors admin guide, API batch lookup docs, and FAQ.
 - 2026-01-31: Added migrations checklist, SAI ingestion spec, optional system stats RPC, and per-section tags/sources UI.

