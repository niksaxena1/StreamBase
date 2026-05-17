# Competitor Tracking Design

Date: 2026-05-17
Status: Proposed for implementation

## Goal

Add a second analytical universe to SpotiBase for competitor catalogs while keeping the current own-catalog data model clean and trustworthy. The first pilot will ingest one competitor playlist:

- Competitor: Paraíso
- Spotify playlist: Paraíso Releases
- Spotify playlist URL: https://open.spotify.com/playlist/2RGHAxvb8iosGgP6pd7GFK
- SpotOnTrack playlist URL: https://www.spotontrack.com/playlists/spotify/8948445
- SpotOnTrack dashboard URL: https://www.spotontrack.com/dashboard/8609

The pilot should let the user switch SpotiBase into a dedicated Competitor Mode and inspect competitor tracks, artists, playlists, and competitor-wide aggregates with the same basic analytical depth as the own-catalog mode, while omitting collector/distributor-specific concepts that do not apply.

## Product shape

SpotiBase will have two top-level modes:

1. **Own Catalog Mode** — current behavior and current tables remain unchanged.
2. **Competitor Mode** — the app reads from competitor-specific tables/RPCs and adopts a clearly distinct visual treatment so the active universe is always obvious.

The mode switch should live in Settings initially and persist per user. Once selected, the main analytical surfaces should read from the active dataset rather than forcing the user into a separate, second-class competitor page.

## Recommended architecture

Use the **same Supabase project** but create a **separate competitor schema/data plane**. Do not mix competitor rows into the current own-catalog tables. Do not create a second Supabase project for the pilot.

### Why

- The current own-catalog system already contains many implicit assumptions about "the catalog" that would become fragile if competitor rows were inserted into the same tables.
- A parallel competitor schema preserves hard semantic separation while still allowing the app to share authentication, deployment, UI components, and future comparison features.
- A second Supabase project would provide stronger physical isolation, but it would duplicate migrations, secrets, workflows, and maintenance before the competitor use case has proven it needs that cost.

## Data model

Create a new schema, tentatively `competitor`, with tables that mirror only the concepts needed for competitor analytics.

### Core tables

- `competitor.labels`
  - one row per competitor label
  - fields: `label_key`, `display_name`, metadata, active flag

- `competitor.playlists`
  - one row per tracked competitor playlist
  - fields: `playlist_key`, `label_key`, `display_name`, `spotify_playlist_id`, `spotify_playlist_image_url`, `sot_playlist_id`, `sot_dashboard_url`, ordering fields

- `competitor.tracks`
  - competitor-facing track metadata
  - likely keyed by ISRC for the pilot, with Spotify metadata parallel to the current `tracks` table

- `competitor.track_daily_streams`
  - daily cumulative stream snapshots by `(date, isrc)`
  - partition monthly, like the existing own-catalog table

- `competitor.playlist_memberships`
  - validity-window membership history for `(playlist_key, isrc)`

- `competitor.playlist_daily_stats`
  - daily precomputed playlist totals/deltas/revenue, parallel to the existing playlist stats table

- `competitor.ingestion_runs`
- `competitor.ingestion_warnings`
- `competitor.raw_exports`
  - competitor-specific pipeline observability and lineage tables

### Identity policy

For the pilot, keep daily competitor facts in the competitor schema even when an ISRC also exists in the own catalog. This prevents accidental mixing and keeps future comparison logic explicit. A future comparison layer may join own-catalog and competitor facts by shared ISRC when intentionally requested.

## App behavior

### Shared screens in v1

Competitor Mode should support the same basic surfaces as current SpotiBase where the semantics still fit:

- Home overview using competitor-wide aggregates
- Playlists dashboard
- Catalog / artist / track drilldowns
- Search
- Track and artist totals and daily movement
- Combined totals for all playlists belonging to a competitor label

### Hidden or deferred in v1

These should not appear in Competitor Mode until they are redesigned for the new universe:

- Collectors
- Distributor/entity health checks
- Own-catalog-specific health warnings
- Deep filter builder parity
- Milestones, concentration views, and richer exploratory analytics

Those are desirable follow-ons, but they should build on the clean architecture rather than distort the pilot.

### UI mode switch

- Add a persistent user setting: `dataset_mode = own | competitor`
- Start with a Settings control
- Visually distinguish Competitor Mode with a different accent treatment and explicit labeling in the shell/header so mode confusion is hard
- Reuse current pages/components where possible, but route all data access through mode-aware query adapters rather than sprinkling conditional logic across many UI files

## Data access pattern

Introduce a mode-aware server/query layer:

- `own` adapter ? existing public tables/RPCs
- `competitor` adapter ? competitor schema tables/RPCs

The UI should ask for concepts like:

- latest playlist stats
- artist series
- track series
- search results
- competitor label totals

rather than knowing which schema provides them. This keeps the mode switch architectural instead of cosmetic.

## Pipeline design

Create competitor-specific config and GitHub Actions while reusing common code paths where possible.

### New config

- `config/competitor_playlists.csv`

Initial pilot row:

- `paraiso_releases`
- `Paraíso Releases`
- `paraiso`
- SpotOnTrack dashboard `8609`
- SpotOnTrack playlist `8948445`
- Spotify playlist `2RGHAxvb8iosGgP6pd7GFK`

### New workflows

- `sot_competitor_daily_playlist_refresh.yml`
- `sot_competitor_daily_dashboard_sync.yml`
- `sot_competitor_daily_export.yml`
- later, if needed, `spotify_competitor_enrich.yml`

### Separation rules

Competitor workflows must use:

- their own config file
- competitor-specific artifact names
- competitor-specific storage prefixes
- competitor-specific ingestion tables
- their own workflow names and concurrency groups

The own-catalog workflows should continue to run unchanged.

## Paraíso pilot flow

1. Populate the empty SpotOnTrack dashboard from the Paraíso Releases playlist.
2. Refresh/export the Paraíso dashboard through competitor workflows.
3. Ingest the export into competitor tables only.
4. Surface Paraíso data in Competitor Mode.
5. Verify that own-catalog analytics, search, and health surfaces remain unchanged.

## Performance posture

- Competitor daily streams should be partitioned monthly from day one.
- Keep playlist-level aggregates precomputed.
- Reuse the existing pagination/downsampling habits already present in SpotiBase.
- The pilot scale is not expected to require a second Supabase project; the main engineering risk is semantic bleed, not raw row count.

## Error handling and safety

- Competitor ingestion should have its own warning stream so failures do not pollute own-catalog health.
- SpotOnTrack sync/export jobs should fail closed on missing data and record explicit summaries.
- Competitor Mode should never read own-catalog tables accidentally through fallback behavior.
- Any comparison feature between own and competitor data should be explicit and opt-in, never implicit.

## Testing strategy

### Backend

- migration tests for new schema/tables/functions
- ingestion tests using Paraíso sample exports
- isolation tests proving competitor writes do not change current own-catalog aggregates
- partition helper tests for competitor daily streams

### App

- adapter tests for own vs competitor mode
- route/page tests proving mode-appropriate queries are selected
- shell tests for visible mode labeling
- search tests scoped to active dataset

### Pipeline

- dry-run tests for competitor SpotOnTrack sync/export
- manual workflow dispatch for the Paraíso pilot
- artifact verification and ingestion summary verification

## Non-goals for the first implementation

- Cross-competitor benchmarking dashboards
- Own-vs-competitor comparison charts
- Full feature parity with filters/milestones/home experimental views
- Separate Supabase project
- Competitor collectors/distributors/entities

## Rollout sequence

1. Add competitor schema and ingestion foundation.
2. Add competitor workflows/config using Paraíso only.
3. Add Settings-backed Competitor Mode plus mode-aware shell.
4. Add basic competitor Home / Playlists / Catalog / Search support.
5. Verify isolation and pilot data quality.
6. Only after that, extend advanced analytics.

## Open decisions resolved for v1

- Storage boundary: same Supabase project, separate competitor schema
- UI structure: global Competitor Mode, not a standalone page
- Pilot scope: one label, one playlist, Paraíso Releases
- Collector/distributor logic: excluded from competitor mode
- Workflow structure: separate competitor workflows, shared implementation where practical
