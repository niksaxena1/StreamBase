# StreamBase `/docs`

> **Where to edit this document**
>
> - `web/src/app/(main-flat)/docs/docs.md`
> - Renderer/UI: `web/src/app/(main-flat)/docs/page.tsx` + `DocsClient.tsx`

This page is the canonical, **human-first** description of how StreamBase works end-to-end (pipeline, UI, data model, operations).

If you’re looking for “how do I use the app?” start with **Quick “How do I…?”** and **What each page does**.
The **SAI / chatbot** sections are optional and live near the bottom.

---

## What is StreamBase?

StreamBase is a **daily ingestion + analytics app** for SpotOnTrack exports: it turns CSV snapshots into a queryable Postgres dataset and a web UI for tracking your catalog and playlists over time.

What you use it for:

- **Catalog analytics**: track/artist performance (streams + estimated revenue) and drilldowns.
- **Operational playlists**: membership history (added/removed) + performance trends.
- **Health & anomalies**: detect bad/missing exports, catalog drift, missing enrichment, and other “something broke” signals.

Where the main pieces live in this repo:

- **Automation scripts** (export/sync/ingest/enrich): `scripts/`
- **Database migrations + RPCs** (apply in Supabase SQL editor): `migrations/`
- **Web app** (Next.js App Router): `web/`

---

## Daily automation schedule (GitHub Actions)

GitHub Actions scheduled workflows use **UTC**. Below is the same schedule shown in **UTC** and **GMT+4** (GST / Asia/Abu_Dhabi).

### Own-catalog schedule

| Workflow | When (UTC) | When (GMT+4) | What it does |
|---|---:|---:|---|
| Dashboard sync (`sot_daily_dashboard_sync.yml`) | 06:00 + 06:30 (fallback) | 10:00 + 10:30 | Keeps SpotOnTrack dashboards in sync with `config/playlists.csv` |
| Playlist refresh (`sot_daily_playlist_refresh.yml`) | 05:00 | 09:00 | Refreshes SpotOnTrack playlists |
| Daily export (`sot_daily_export.yml`) | 07:30 (primary) + 08:30 (fallback) | 11:30 + 12:30 | Exports dashboards → uploads to Storage → ingests into Supabase (idempotent) |
| RapidAPI stale-track fix (`rapidapi_stale_fix.yml`) | 09:15 | 13:15 | Attempts own-catalog stale-track corrections after export |
| Spotify enrichment (`spotify_enrich.yml`) | 10:00 | 14:00 | Enriches missing track metadata via Spotify |
| Artist image cache refresh (`spotify_artist_image_refresh.yml`) | 15:00 (first Friday) | 19:00 (first Friday) | Refreshes cached Spotify artist images (monthly) |

### Competitor Mode schedule

Competitor workflows are intentionally separate from the own-catalog workflows: they use different workflow files, config, concurrency groups, and the `competitor` database schema.

| Workflow | When (UTC) | When (GMT+4) | What it does |
|---|---:|---:|---|
| Competitor playlist refresh (`sot_competitor_daily_playlist_refresh.yml`) | 05:15 | 09:15 | Refreshes SpotOnTrack competitor playlists |
| Competitor dashboard sync (`sot_competitor_daily_dashboard_sync.yml`) | 06:15 + 06:45 (fallback) | 10:15 + 10:45 | Mirrors competitor playlists into SpotOnTrack dashboards |
| Competitor export (`sot_competitor_daily_export.yml`) | 08:00 + 09:00 (fallback) | 12:00 + 13:00 | Exports competitor dashboards and ingests them into the `competitor` schema |
| Spotify competitor enrichment (`spotify_competitor_enrich.yml`) | 10:20 | 14:20 | Enriches competitor tracks with Spotify metadata |

The competitor jobs are offset from the own-catalog jobs to reduce shared pressure on GitHub runners, SpotOnTrack, and Spotify API rate limits.

### Competitor Mode pages

Competitor Mode is a parallel analytics universe, not a merge into your own catalog:

- **Home** ? overview for the selected competitor across all of its tracked playlists
- **Playlists** ? playlist-level totals plus current tracks; daily per-track deltas appear once at least two snapshots exist
- **Catalog** ? competitor artists and tracks
- **Competitors** ? competitive-intelligence cockpit: label comparison chart/table, cross-label movers, catalog churn, overlap matrix (pipeline health is on `/health`)
- **Health** ? competitor ingestion checks (stale playlists, row mismatches, warnings, missing totals)

The selected competitor is global. One competitor may own multiple playlists, and changing the selector changes supported competitor-aware surfaces across the app.

Competitor RPCs used by `/competitors` (schema `competitor`):

- `label_distinct_artist_counts(p_run_date)`
- `label_daily_series(p_start_date, p_end_date)` — per-label chart series (aggregated server-side)
- `label_top_tracks_daily(p_run_date, p_limit, p_direction)` — gainers/losers
- `label_membership_churn(p_window_days, p_as_of)` — catalog adds/removes
- `label_overlap_matrix(p_as_of)` — pairwise Jaccard similarity

Notes:

- The export workflow has a **sync gate**: it blocks if there is no **successful** Dashboard Sync run for the same UTC date (unless you manually override).
- The export workflow also has an **idempotency pre-check**: if `ingestion_runs` already shows `status=success` for that run date, it exits early unless `force_reingest=true` is set on a manual dispatch.
- There is also a manual-only workflow: `sot_debug_scan_tracks.yml` (use it when a specific dashboard/playlist needs debugging; it uploads screenshots/logs as artifacts).

Common secrets used by workflows:

- `SOT_EMAIL`, `SOT_PASSWORD` (SpotOnTrack automation)
- `SOT_STORAGE_STATE_B64` (optional login/session state)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (upload + ingestion)
- `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_PREFIX` (optional storage upload)
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (Spotify enrichment/image refresh)
- `NOTIFY_SMTP_PASSWORD` (email notifications on failures/anomalies)

---

## Quick “How do I…?” (user cookbook)

### Search for a track / artist / playlist

- Use the **search bar in the top header** (visible on most pages).
- Type at least 2 characters.
- Click result behavior:
  - **Track** → opens `/catalog?isrc=<ISRC>` (and may include `artist_id` if known)
  - **Artist** → opens `/catalog?artist_id=<spotify_artist_id>`
  - **Playlist** → opens `/playlists?playlist_key=<playlist_key>`
- The small number shown at the right of each result is the **latest total streams** for that entity (see `/api/search-stats`).

Implementation pointers:

- Search UI: `web/src/components/shell/SearchBar.tsx`
- Search API: `web/src/app/api/search/route.ts` (uses Postgres RPC `search_all`)
- Competitor Mode uses the separate `competitor` schema plus a user setting named `dataset_mode`; when active, search and supported analytics surfaces read competitor data instead of own-catalog data.
- `/competitors` is the competitive-intelligence cockpit (label comparison chart/table, cross-label movers, catalog churn, overlap matrix). It is intentionally hidden outside Competitor Mode. Pipeline health lives on `/health`.
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
- Select a playlist (or open directly `/playlists?playlist_key=<playlist_key>`)
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

## FAQ (common questions)

<!-- tags: faq, glossary -->

### Is a track unique by ISRC?

Yes. In StreamBase, **ISRC is the primary track identity** (`tracks.isrc` and joins to `track_daily_streams.isrc`).

### What is the difference between Spotify track id and ISRC?

- Spotify track id: identifies a specific Spotify track object (can vary by territory/duplicate uploads).
- ISRC: the industry recording identifier; more stable across releases and systems.

StreamBase uses ISRC because SpotOnTrack exports are ISRC-based and it’s the best stable join key.

### Why do dates look “2 days behind”?

SpotOnTrack has a known lag; UI displays “data date” by shifting run date by `SOT_DATA_LAG_DAYS=2`.

### Why are some daily values zero or missing?

Common causes:

- First day of ingestion (no previous day to diff against)
- Missing export / partial export (check Health)
- Track not present in catalog snapshot for the day (non-catalog track warnings)

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
- `(main-flat)` segment: primary authenticated app shell + dashboards (`/`, `/catalog`, `/playlists`, `/collectors`, `/health`, `/settings`, `/docs`)
- `(main)` segment: compatibility redirects (e.g. `/tracks/<ISRC>`, `/artists/<spotify_artist_id>`) and legacy entrypoints
- `/api/*`: server-only API routes (Next.js)

---

## Security & access model (how auth + RLS works here)

<!-- tags: security, auth, rls, supabase -->
<!-- sources: web/src/app/(main-flat)/layout.tsx, web/src/lib/supabase/server.ts, web/src/lib/supabase/service.ts, web/src/lib/supabase/client.ts -->

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

So the pattern in `(main-flat)` pages is:

1) Verify a real session exists (`supabaseServer().auth.getUser()`), otherwise redirect to `/login`
2) Verify admin capability (`sb.rpc("is_admin")`), otherwise redirect away
3) Read analytics using `supabaseService()` + `cachedQuery()`

### Raw analytics tables vs public integration views

Raw own-catalog analytics tables are not a public API surface. Tables such as
`track_daily_streams`, its monthly partitions, `artist_daily_stats`,
`track_daily_stream_overrides`, `isrc_aliases`, and health exclusion tables have
RLS enabled and no direct `anon` access.

Ledgenta and other cross-project consumers must read only the column-limited
`*_public` views, for example `track_daily_streams_effective_public`,
`tracks_public`, `playlist_memberships_public`, `playlists_public`,
`playlist_daily_stats_public`, `playlists_with_latest_stats_public`, and
`collector_daily_agg_public`. Keep those views read-only (`SELECT` only) unless a
new integration contract explicitly requires more.

### Environment variables (web app)

Defined in `web/env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SPOTIFY_CLIENT_ID` (server-only)
- `SPOTIFY_CLIENT_SECRET` (server-only)
- `REVALIDATE_SECRET` (server-only; used by revalidation endpoints if/when enabled)
- `CRON_SECRET` (server-only; Vercel Cron sends this as Bearer token for `/api/cron/ensure-partitions`)
- `OPENAI_API_KEY` (optional, server-only; enables SAI embeddings + chat)
- `OPENAI_EMBED_MODEL` (optional; default `text-embedding-3-small`)
- `OPENAI_CHAT_MODEL` (optional; default `gpt-4o-mini`)
- `SAI_EMBED_DIMS` (optional; default `1536`)
- `SAI_ADMIN_TOKEN` (optional, server-only; secures admin-only SAI endpoints like reindex/diagnostics; send as header `x-sai-admin-token`)
- `SB_HEALTH_DEBUG_TOKEN` (optional, server-only; with `debug=1` on `/api/health-summary`, send as header `x-sb-health-debug-token`)

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

- `web/src/app/(main-flat)/page.tsx`

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

- Page (server): `web/src/app/(main-flat)/catalog/page.tsx`
- UI (client): `web/src/app/(main-flat)/catalog/CatalogPageClient.tsx`
- RPCs: `migrations/add_catalog_artist_aggregate_rpcs.sql`

Also note:

- `/artists/<spotify_artist_id>` redirects to `/catalog?artist_id=<spotify_artist_id>`
- `/tracks/<ISRC>` redirects to `/catalog?isrc=<ISRC>`

### Playlists (`/playlists`)

- Purpose: playlist performance + membership drilldowns over time.
- What you can do:
  - Select a playlist
  - Change time range
  - View “top tracks” in the playlist
  - View “added” and “removed” tracks (membership changes)
  - Open playlist on Spotify (if enriched with Spotify playlist id)

Implementation pointers:

- Page: `web/src/app/(main-flat)/playlists/page.tsx`
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
- Optional Settings toggle: `collector_entity_playlist_stats_enabled` switches TG to `tg_total` and PL to `p_total` using `collector_daily_agg_entity_playlists`, `collector_daily_compare_entity_playlists`, and scoped collector RPCs.
- `playlist_daily_stats` (top playlists within the selected collector for the latest date)

Where those collector tables come from:

- `migrations/add_collectors_aggregate_views.sql` creates the views:
  - `collector_daily_agg`
  - `collector_daily_compare`

Files:

- `web/src/app/(main-flat)/collectors/page.tsx`
- `web/src/app/(main-flat)/collectors/CollectorsClient.tsx`

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

- Page: `web/src/app/(main-flat)/health/page.tsx`
- Expandable row UI: `web/src/components/health/WarningRow.tsx`
- Health summary API (polling): `web/src/app/api/health-summary/route.ts`
- Health RPCs:
  - `migrations/add_health_missing_catalog_rpcs.sql`
  - `migrations/add_health_track_count_swing_rpc.sql`
  - `migrations/add_health_missing_enrichment_tracks_rpc.sql`
  - `migrations/add_health_entity_distro_drift_rpc.sql`
  - `migrations/add_health_distro_overlap_rpc.sql`

### Settings (`/settings`)

- Purpose: operational controls, user preferences, and data repair tools.
- What you can do:
  - **Health exclusions**: add/remove track exclusions for `non_catalog_tracks_present` and `tracks_missing_enrichment` warnings
  - **Manual stream overrides**: repair missing/incorrect SpotOnTrack snapshots for specific (run date, ISRC) with an audit note
  - **Payout rate**: configure the USD-per-1000-streams rate used for revenue estimates across the app
  - **Currency display**: choose how revenue numbers are formatted
  - **Collector stats scope**: optionally use `TG Total` / `P Total` entity playlists for TG and PL collector stats
  - **Chart preferences**: week highlight day, chart start date, y-axis zoom behavior
  - **Home dashboard filters**: toggle which scopes/sections appear on the Home page
  - **SAI toggle**: enable/disable the AI assistant chat widget

Files:

- `web/src/app/(main-flat)/settings/page.tsx`
- `web/src/app/(main-flat)/settings/TrackExclusionForm.tsx`
- `web/src/app/(main-flat)/settings/ManualStreamOverrideForm.tsx`

DB setup:

- Apply `migrations/add_user_settings_table.sql` (creates `user_settings` for per-user preferences)
- Apply `migrations/add_collector_entity_playlist_stats_setting.sql` (adds the TG/PL entity-playlist collector stats toggle and scoped SQL objects)
- Apply `migrations/add_track_daily_stream_overrides.sql` (creates `track_daily_stream_overrides` + effective views + recompute RPC)
- Apply `migrations/adopt_track_daily_streams_effective.sql` (updates key RPCs to read the effective stream snapshots)

### Catalog Config (`/catalog/config`)

- Purpose: admin view of all artists and tracks in the system with stats.
- What you can do:
  - Browse all artists (with track counts and stream totals)
  - Browse all tracks (with total/daily streams)
  - Search/filter within each list

Files:

- `web/src/app/(main-flat)/catalog/config/page.tsx`

### Playlists Config (`/playlists/config`)

- Purpose: admin view of all playlists with operational metadata.
- What you can do:
  - See all playlists with track counts, streams, and thumbnails
  - Trigger Spotify thumbnail refresh
  - Navigate to per-playlist settings

Files:

- `web/src/app/(main-flat)/playlists/config/page.tsx`

### Playlist Settings (`/playlists/config/settings`)

- Purpose: edit operational metadata for a playlist.
- What you can do:
  - Set/change the **collector** assignment
  - Set/change **playlist type** (Catalog, Label, Entity, Distro)
  - Set/change **entity playlist key** (links a Distro playlist to its Entity)
  - Set/change **Spotify playlist ID** and **display order**

Files:

- `web/src/app/(main-flat)/playlists/config/settings/page.tsx`

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
- `health_unplayable_track_exclusions`
  - Exclusions for unplayable/taken-down tracks in health checks
- `spotify_artist_images`
  - Cache table for artist images (reduces Spotify API calls)
- `user_settings`
  - Per-user preferences (payout rate, currency, chart options, SAI toggle, home filters)
- `track_daily_stream_overrides`
  - Manual corrections to stream snapshots (with audit notes); consumed via effective views
- `collector_monthly_actual_revenue`
  - Monthly “actual revenue” overlays entered in the Collectors page
- `track_daily_streams_effective` (view)
  - Resolves `track_daily_streams` + manual overrides into a single effective snapshot
- `track_daily_streams_effective_public` (view)
  - Public-safe subset of the effective view (date, isrc, streams_cumulative only)

---

## Data dictionary (fields used by the app)

<!-- tags: schema, data-dictionary, tables -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main-flat)/*, web/src/app/(main)/*, migrations/*.sql -->

This is a **practical schema snapshot**: it lists the fields that the current app code relies on most.
Your DB may have additional columns; those are fine.

### `tracks` (one row per ISRC)

| Field | Type (typical) | Meaning / usage |
|---|---|---|
| `isrc` | text (PK) | Track identity in StreamBase |
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
| `playlist_type` | text/null | Classification: Catalog, Label, Entity, Distro (used by entity/distro drift checks) |
| `entity_playlist_key` | text/null | Links a Distro playlist to its parent Entity playlist (used by `entity_distro_drift` warning) |
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
| `est_revenue_total` | numeric | Estimated total revenue (derived from streams; UI rate is configurable) |
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
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main-flat)/health/page.tsx, web/src/components/health/WarningRow.tsx -->

These are the warning codes emitted by the ingestion script today:

| Code | Severity | Meaning | Where it comes from | Fix / next step |
|---|---|---|---|---|
| `missing_export` | critical | Expected CSV file is missing | ingestion script checks `exports/YYYY/MM/DD/<playlist_key>.csv` exists | Fix exporter/config; re-run export; confirm playlist_key matches |
| `zero_row_export` | critical | CSV exists but has 0 rows | ingestion script `count_csv_rows` | Investigate SpotOnTrack export page; often partial load or auth/session issues |
| `min_rows_failed` | critical | Configured minimum row threshold failed; ingestion aborted to protect integrity | ingestion script checks `Playlist.min_rows` | Fix exporter stability; only lower min_rows after confirming expected row counts |
| `track_count_swing_hard_fail` | critical | Catalog playlist changed by ≥70% vs previous day; ingestion aborted | ingestion hard safety for catalog playlists | This usually means partial export; fix exporter/run again |
| `track_count_swing` | warn/critical | Track count swing vs yesterday (warn), or catalog count dropped by > threshold (critical) | ingestion compares `playlist_daily_stats` day-over-day | Expand warning in UI to see changes; validate exports |
| `entity_distro_drift` | warn | “Entity” playlist membership doesn’t match the union of its “Distro” playlists (extra/missing tracks) | ingestion compares membership sets for `playlist_type = 'Entity'` vs all related `playlist_type = 'Distro'` playlists using `entity_playlist_key` | Fix playlist mapping or membership; use Health expansion to see extra/missing tracks |
| `distro_overlap` | warn | An ISRC appears in 2+ Distro playlists on the same day (should be exclusive) | ingestion checks overlapping membership across `playlist_type = 'Distro'` playlists | Fix distro assignment; use Health expansion / RPC to list overlapping tracks |
| `high_zero_stream_rate` | warn | Catalog export has too many rows with 0 streams | ingestion computes zero-stream ratio for catalog playlists | Investigate SpotOnTrack data freshness; ensure correct dashboard/export format |
| `catalog_streams_missing_prev_nonzero` | critical | SpotOnTrack export had missing/blank/non-numeric `spotify_streams_total` for track(s) that had non-zero cumulative streams yesterday. StreamBase records these as “missing snapshots” for today (no `track_daily_streams` row) | ingestion detects missing stream values in catalog exports and checks yesterday’s `track_daily_streams` | Treat as source instability; inspect raw CSV; decide later whether to impute/carry-forward |
| `catalog_missing_stream_snapshots` | critical | Explicit count of catalog tracks that appeared in catalog exports but did **not** get a valid `track_daily_streams` snapshot row today (missing/invalid stream totals) | ingestion compares “expected catalog ISRCs” vs today’s snapshot set | Treat as a data-quality break; inspect raw exports; consider re-ingest after fixing exporter |
| `total_streams_decreased` | critical | A playlist’s `total_streams_cumulative` decreased vs yesterday (should not happen for cumulative snapshots) | ingestion computes `playlist_daily_stats` and checks monotonicity vs previous day | Investigate catalog snapshot integrity (missing/invalid stream totals) and source exports |
| `non_catalog_tracks_present` | critical | Playlist contains tracks not present in catalog snapshot for that day | ingestion compares playlist ISRC set vs `track_daily_streams` ISRCs | If intentional: add exclusions in Settings; else fix catalog export/enrichment |
| `tracks_missing_enrichment` | info | Tracks missing Spotify enrichment (no artist ids) | ingestion checks `tracks.spotify_artist_ids IS NULL` | Run Spotify enrichment to fill metadata |
| `ingestion_exception` | critical | Script threw an exception (catch-all) | ingestion exception handler | Open run logs URL; fix root cause; rerun |

Notes:

- The Health UI also runs “drilldown” RPCs so you can expand some warnings to see impacted tracks.
- Exclusions apply primarily to `non_catalog_tracks_present`.

---

## API routes (Next.js)

- `/api/search` (**authenticated**)
  - unified search via Postgres RPC `search_all(q, max_results)`
  - hydrates artist images using DB cache `spotify_artist_images`
- `/api/search-stats` (**authenticated**)
  - hover stats using:
    - `track_daily_streams` (track)
    - `artist_total_streams_for_date` (artist)
    - `playlist_total_streams_for_date` (playlist)
- `/api/health-summary` (**authenticated session**)
  - lightweight polling payload for header banner
  - optional debug: `?debug=1` plus header `x-sb-health-debug-token` matching `SB_HEALTH_DEBUG_TOKEN` (do not pass tokens in query strings)
- `/api/breadcrumb/artist`, `/api/breadcrumb/track` (**authenticated**)
  - dynamic labels for breadcrumbs
- `/api/spotify-track` (**authenticated**)
  - best-effort Spotify lookup by ISRC (for album image)
- `/api/spotify-track-batch` (**authenticated**)
  - batch Spotify lookup by ISRC (bounded to 50 ISRCs, concurrency-limited)
- `/api/cron/ensure-partitions`
  - ops endpoint used by Vercel Cron to keep `track_daily_streams` monthly partitions created ahead of time
  - requires `CRON_SECRET` (Authorization: Bearer)
- `/api/exports` (**JWT-validated session**)
  - redirects to a short-lived signed URL for a Storage object (`bucket` + `key` query params); requires logged-in user
- `/api/user-settings/*`
  - persisted per-user UI preferences (rate, currency display, chart zoom/start date, home filters/milestones, SAI toggle)
- `/api/collectors/comparison-drilldown`
  - paged drilldown data for Collectors comparison tables (tracks/artists/playlists)
- `/api/collectors/monthly-revenue-forecast`
  - reads/writes monthly “actual revenue” overlays when configured in DB
- `/api/admin/spotify/refresh-playlist-thumbnails`
  - admin-only maintenance endpoint for playlist thumbnail cache refresh
- `/api/artists/options`, `/api/playlists/options`
  - admin-only “options lists” used by config UIs (artist cache and playlist table)
- `/api/playlists/memberships`
  - admin-only membership snapshot export for one or more playlists on a date (paged internally to avoid PostgREST caps)
- `/api/reports/playlist-streams-7d`
  - admin-only XLSX report (last 7 days cumulative streams for key playlists)
- `/api/sai/*` (optional)
  - `/api/sai/chat`, `/api/sai/new`: chat endpoints
  - `/api/sai/docs/reindex`: (admin token) builds embeddings index for `/docs`
  - `/api/sai/diagnostics`: header `x-sai-admin-token` (same as `SAI_ADMIN_TOKEN`) — environment + DB capability checks

Files live under:

- `web/src/app/api/*`

---

## Postgres RPCs (Supabase): why they exist and what they do

StreamBase pushes “heavy computations” into Postgres for:

- fewer roundtrips
- correct, index-aware joins
- stable performance as tables grow
- smaller payloads to the UI

Key RPC sets:

- Search: `migrations/add_search_all_rpc.sql`
- Catalog artist aggregates: `migrations/add_catalog_artist_aggregate_rpcs.sql`
- Playlists heavy tables: `migrations/add_playlists_fast_tables_rpcs.sql`
- Home scatter: `home_track_scatter_points` (returns all catalog tracks + streams for a run date)
- Collectors (paged drilldowns):
  - `migrations/add_collector_tracks_rpc_paged.sql` (`collector_tracks_paged`)
  - `migrations/add_collector_artists_stats_rpc_paged.sql` (`collector_artists_stats_paged`)
  - `migrations/add_collector_artist_counts_rpc.sql` (`collector_artist_counts_for_date`)
- Health drilldowns:
  - `migrations/add_health_missing_catalog_rpcs.sql`
  - `migrations/add_health_track_count_swing_rpc.sql`
  - `migrations/add_health_missing_enrichment_tracks_rpc.sql`
  - `migrations/add_health_entity_distro_drift_rpc.sql` (`health_entity_distro_drift`)
  - `migrations/add_health_distro_overlap_rpc.sql` (`health_distro_overlap_tracks`)
  - `migrations/add_health_unplayable_candidates_rpc.sql` (`health_unplayable_candidates`)
- Search hover stats: `migrations/add_search_stats_aggregate_rpcs.sql`
- Stream override cascade: `spotibase_recompute_playlist_daily_stats_cascade`, `spotibase_remove_stream_override` (in `migrations/fix_data_integrity_constraints.sql`)
- Playlists batch counts: `playlists_latest_track_counts`
- Artist collaboration graph: `migrations/add_artist_collaboration_graph_rpc.sql` (`artist_collaboration_graph`)
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

- `migrations/add_spotibase_docs_inventory_rpc.sql`
  - Enables `/docs` “Inventory” box (repo migrations list + optional DB inventory JSON).
  - Without it: the DB inventory section shows “—”.

- `migrations/add_sai_docs_embeddings.sql` (optional, SAI)
  - Enables docs embeddings storage (`sai_doc_chunks`) + the `sai_docs_search` RPC.
  - Without it: SAI falls back to lexical docs search (or has no vector retrieval if enabled in code).

### Optional (partitioning automation)

- `migrations/add_ensure_track_daily_streams_partitions.sql`
  - Adds `ensure_track_daily_streams_partitions(months_ahead)` which is used by `/api/cron/ensure-partitions`.
  - If you have partitioned `track_daily_streams`, you should run this monthly (Vercel Cron recommended; set `CRON_SECRET` in `web/env.example`).

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

### Partitioning (already implemented)

`track_daily_streams` is now **partitioned by month**. This means:

- Queries that filter by date only touch the relevant monthly partition (partition pruning).
- New partitions must exist before inserting data for a new month.
- The helper `ensure_track_daily_streams_partitions(months_ahead)` creates missing partitions and is automated via `/api/cron/ensure-partitions` (Vercel Cron, 1st of every month). Set `CRON_SECRET` in your env.
- See `docs/PARTITIONING-TRACK-DAILY-STREAMS.md` for the full details.

### If you outgrow the current scale, the next upgrades are

- Add/verify indexes in migrations (especially GIN/trgm and snapshot date/isrc composite indexes).
- Push more work into Postgres (RPCs/materialized views) so the app never scans large tables.
- Add materialized aggregates (artist/playlist rollups per day) if snapshot joins get slow.
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
  - StreamBase uses SpotOnTrack exports (lagged)
  - UI shows **data date** (run date minus 2 days)
  - Tables store cumulative snapshots; daily is derived by difference

---

## Collectors admin guide (how to maintain collectors)

<!-- tags: collectors, admin, playlists -->
<!-- sources: web/src/app/(main-flat)/collectors/page.tsx, migrations/add_collectors_aggregate_views.sql -->

### What a collector is (in this codebase)

- A “collector” is a **label on playlists** (`playlists.collector`)
- The Collectors page aggregates playlist metrics by that label

### How collector metrics are computed

- Views are created in `migrations/add_collectors_aggregate_views.sql`:
  - `collector_daily_agg`: sums `playlist_daily_stats` across all playlists assigned to a collector, per day
  - `collector_daily_compare`: adds window comparisons (yesterday delta, delta vs previous 7-day average)
- `migrations/add_collector_entity_playlist_stats_setting.sql` adds an opt-in alternate scope where TG uses `tg_total` and PL uses `p_total`; other collectors remain assigned-playlist based.

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

## KPI & metric definitions (exact meaning of numbers you see)

<!-- tags: kpis, metrics, semantics -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main-flat)/page.tsx, web/src/app/(main-flat)/playlists/page.tsx, web/src/app/(main-flat)/catalog/page.tsx, web/src/app/(main-flat)/collectors/page.tsx -->

This section defines the “official meaning” of the most important metrics shown in the UI.

### Track-level

| KPI/Label | Definition | Source |
|---|---|---|
| Track total streams | `track_daily_streams.streams_cumulative` for the selected run date | `track_daily_streams` |
| Track daily streams | `today(streams_cumulative) - yesterday(streams_cumulative)` (when both exist); some views clamp at 0 | derived |
| Track revenue (est.) | `streams * (rate_per_1k / 1000)` | UI uses the configured “Rate” setting (default 2.00 per 1,000) |

### Playlist-level (`playlist_daily_stats`)

| KPI/Label | Definition | Notes |
|---|---|---|
| Tracks | `track_count` | active membership size on that day |
| Total streams | `total_streams_cumulative` | sum of cumulative streams across tracks (using catalog snapshot) |
| Daily streams (net) | `daily_streams_net` | day-over-day delta of `total_streams_cumulative` |
| Missing streams tracks | `missing_streams_track_count` | membership tracks missing from catalog snapshot that day (after exclusions) |
| Revenue (daily/total) | derived from `daily_streams_net` / `total_streams_cumulative` | UI uses the configured “Rate” setting (default 2.00 per 1,000) |

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
| TG/PL entity collector aggregates | when enabled in Settings, TG/PL use `TG Total` / `P Total` entity playlists | `collector_daily_agg_entity_playlists`, scoped collector RPCs |

---

## UI label → KPI dictionary (exact on-screen text mapping)

<!-- tags: kpis, ui, reference -->
<!-- sources: web/src/app/(main-flat)/page.tsx, web/src/app/(main-flat)/playlists/PlaylistMetricsClient.tsx, web/src/app/(main-flat)/collectors/CollectorsClient.tsx, web/src/app/(main-flat)/health/page.tsx -->

Use this when you (or SAI) want to map what you see on screen to the canonical definition.

### Home (`/`)

| UI label | Meaning |
|---|---|
| `Revenue (Daily)` | derived from `daily_streams_net × (rate_per_1k / 1000)` (Rate is configurable in Settings) |
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
| `Est. revenue (cumulative)` | derived from `playlist_daily_stats.total_streams_cumulative × (rate_per_1k / 1000)` |
| `Est. revenue (daily)` | derived from `playlist_daily_stats.daily_streams_net × (rate_per_1k / 1000)` |
| `Track count` | `playlist_daily_stats.track_count` |
| `Track change (daily)` | `today(track_count) - yesterday(track_count)` (can be negative) |
| `Track count over time` | chart of `track_count` snapshots over the chosen range |

### Collectors (`/collectors`)

| UI label | Meaning |
|---|---|
| `Est. revenue (daily)` | derived from `collector_daily_agg.daily_streams_net × (rate_per_1k / 1000)` |
| `Est. revenue (total)` | derived from `collector_daily_agg.total_streams_cumulative × (rate_per_1k / 1000)` |
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
- Cumulative snapshots should be **monotonic non-decreasing** per ISRC and (by summation) per playlist total. If totals decrease, StreamBase emits critical health warnings (see `total_streams_decreased`).
- If SpotOnTrack exports contain missing/invalid `spotify_streams_total` values:
  - StreamBase may record that day as a **missing snapshot** for affected ISRCs (no row in `track_daily_streams` for that date), because `streams_cumulative` is non-nullable in the current schema.
  - The Health page surfaces this via `catalog_streams_missing_prev_nonzero` and `catalog_missing_stream_snapshots`.

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
<!-- sources: web/src/lib/sotDates.ts, web/src/app/(main-flat)/health/page.tsx, web/src/app/(main-flat)/page.tsx, web/src/app/api/search-stats/route.ts -->

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

`track_daily_streams` dominates growth. **Partitioning by month is already in place** (see the [Partitioning (already implemented)](#partitioning-already-implemented) section above).

If performance still regresses at scale, next steps would be:

- ensure all heavy queries are date-bounded
- add materialized aggregates (artist/playlist rollups per day)

---

## Backup / recovery & “bad data” playbook

<!-- tags: recovery, ops, ingestion -->
<!-- sources: scripts/ingest_exports_to_supabase.py, web/src/app/(main-flat)/health/page.tsx -->

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
- When SpotOnTrack is unstable, you may see critical warnings like:
  - `catalog_streams_missing_prev_nonzero`
  - `catalog_missing_stream_snapshots`
  - `total_streams_decreased`
  These indicate “source data quality break”, not necessarily a bug in StreamBase.

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

## Query param & URL reference (quick lookup)

<!-- tags: urls, reference -->
<!-- sources: web/src/app/(main-flat)/catalog/page.tsx, web/src/app/(main-flat)/playlists/page.tsx, web/src/app/(main-flat)/collectors/page.tsx, web/src/components/shell/SearchBar.tsx, web/src/app/(main-flat)/health/page.tsx -->

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

## AI assistant (SAI)

<!-- tags: sai, chatbot -->

This section is only relevant if you enable the SAI chat button in `/settings`.

### Can SAI (StreamBase AI) read these docs later?

Yes — recommended approach is **RAG (retrieval augmented generation)**:

- Treat `docs.md` as a source-of-truth corpus
- Chunk by `##` sections (this page already follows that structure)
- Index chunks (embeddings + metadata: tags/sources)
- Retrieve relevant chunks at question time

This keeps SAI grounded in the actual system behavior and avoids hallucinating.

### Canonical facts SAI should learn

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

### SAI ingestion spec (recommended format for RAG)

#### Recommended ingestion source(s)

- Primary: `web/src/app/(main-flat)/docs/docs.md`
- Secondary:
  - `scripts/ingest_exports_to_supabase.py` (warning meanings + ingestion logic)
  - `migrations/*.sql` (RPC definitions + performance indexes)

#### Chunking rules

- Chunk by `##` section boundaries.
- Keep each chunk:
  - title
  - body markdown
  - tags (from `<!-- tags: ... -->`)
  - sources (from `<!-- sources: ... -->`)

#### Retrieval rules (practical)

- Always retrieve:
  - at least 1 “page behavior” chunk (how to do X)
  - at least 1 “data model/RPC” chunk (where the numbers come from)
  - at least 1 “debugging/runbook” chunk when the user asks “why” or “error”

#### Answer policy

- If a question is about numbers, SAI should:
  - state which table/RPC defines the number
  - state run date vs data date assumptions
  - warn when the answer is an estimate (e.g. track_daily_streams reltuples estimate)

### SAI answer templates (for consistent chatbot responses)

If you want SAI to be reliable, enforce answer structure.

#### Template: “What does metric X mean?”

- **Definition** (1 sentence)
- **Where it comes from** (table/RPC/column)
- **Date semantics** (run date vs data date)
- **Edge cases** (day 1, missing yesterday, missing snapshot, exclusions)
- **How to verify in UI** (page + click path)

#### Template: “Why is number X wrong?”

- **Most likely causes** (ordered)
- **How to confirm** (tables/pages to check)
- **Fix** (what to run/change)
- **Prevent recurrence** (min_rows, indexes, guardrails)

#### Template: “How do I do X in the app?”

- **Path** (URL / nav path)
- **Steps** (3–6 bullets)
- **Data impact** (tables/RPCs touched/read)

### SAI security constraints (non-negotiable)

- Never expose secrets (`SUPABASE_SERVICE_ROLE_KEY`, Spotify secrets, cookies).
- Never allow writes unless explicitly authorized (avoid arbitrary SQL execution).
- Prefer “read-only + explain + point to sources”.

---

## Changelog

- 2026-02-09: Major docs refresh: expanded Settings page (8 features), added config pages (`/catalog/config`, `/playlists/config`, `/playlists/config/settings`), updated performance section (partitioning is now implemented), added SAI/CRON env vars, expanded data dictionary (6 new tables/views), added 10+ missing RPCs, updated `playlists` table fields (`entity_playlist_key`, `playlist_type` semantics), route layout (`(main-flat)` primary), expanded API routes list, new health warning codes (`entity_distro_drift`, `distro_overlap`), GitHub Actions schedule/notes, and fixed SAI docs indexing path.
- 2026-02-01: Added ingestion health warnings for missing/invalid SpotOnTrack stream totals (`catalog_streams_missing_prev_nonzero`, `catalog_missing_stream_snapshots`) and a critical check for day-over-day decreases in playlist total streams (`total_streams_decreased`).
- 2026-01-31: Added migrations checklist, SAI ingestion spec, optional system stats RPC, and per-section tags/sources UI.
- 2026-01-31: Added security/access model, data dictionary, warning catalog, ops runbook, collectors admin guide, API batch lookup docs, and FAQ.
- 2026-01-31: Added cookbook, per-page actions, collectors definition, scale guidance, and docs search/collapse UI.
- 2026-01-31: Added `/docs` page + initial architecture docs.
