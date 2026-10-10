# Competitor Mode Operations

## Current scope

| Competitor | Playlist key | Spotify playlist | SpotOnTrack playlist | Dashboard |
|---|---|---|---:|---:|
| Para?so | `paraiso_releases` | `2RGHAxvb8iosGgP6pd7GFK` | `8948445` | `8609` |
| Soave | `soave_releases` | `6DxYxhfXDnLeaNWHJvHPTu` | `3671138` | `8628` |
| Soave | `soave_dusk_records_releases` | `5AQjRSZARLXzymYlDsDwW0` | `7405352` | `8950` |
| Soave | `soave_radio_releases` | `0WZOHZmfxXX5kTELccugyc` | `5156334` | `8951` |
| Soave | `soave_lofi_releases` | `3j0rbud0hqVC9ZnoV8SPWv` | `7726542` | `8952` |
| Soave | `soave_day_night_records_releases` | `0JkD59thdDkaXd9gaXZSqc` | `10712039` | `8953` |
| Soave | `soave_blaaktrax_releases` | `0kADH0u3ejdnaUpRg57q2K` | `17632814` | `8954` |
| Soave | `soave_evaos_releases` | `6sgBTQYyvMjxRydyuRX7FC` | `17859449` | `11239` |
| ChillYourMind | `chillyourmind_releases` | `3qExK19cdWKJ5RmCTKzwiy` | `8887309` | `8629` |
| selected. | `selected_releases` | `6QgHdyoJ49khJQ7ZKpEHOi` | `203886` | `8955` |
| ATLAST | `atlast_all_releases` | `4Oeev4VKRe0vknDwwmzc7a` | `51750` | `8957` |
| ATLAST | `atlast_miami_beats_all_releases` | `6Up2rsR545N0TZqCm8jrg9` | `456886` | `8958` |
| MusicUp | `musicup_releases` | `19rThvNZ2ajkvHC2Zp6s05` | `10438539` | `11226` |
| Perfect Havoc | `perfect_havoc_records` | `5CTdZN6MZc0FOcUL0Olo6g` | `587437` | `11280` |
| Million Hills | `million_hills_releases` | `1s2T5rJkG0LYiUswJKRY3o` | `17861230` | `11287` |
| Lilly Era | `lilly_era_releases` | `5RfLnuLf2eUQbnOhS6GKUn` | `9814064` | `12263` |
| Diepgraven | `diepgraven_records_all_releases` | `07MzpeD6a32EYRKuxp60o0` | `4704229` | `12262` |

## Isolation rule

Competitor stream corrections never update `competitor.track_daily_streams` or raw
exports. Bounded stale runs and reviewed source corrections are stored in
`competitor.track_daily_stream_overrides`; derived playlist and artist statistics are
then rebuilt from `competitor.track_daily_streams_effective_public`.

After each competitor ingest, StreamBase checks the latest 14-day window for stale
runs that now have a later catch-up anchor. It writes only bounded interpolation
overrides, recomputes playlist statistics (including first-day playlist onboarding),
refreshes artist statistics in small batches, and invalidates the web cache.

Competitor data lives in the `competitor` schema. It must never be written into the own-catalog `public` tables.

## Daily workflows

- `SOT Competitor Daily Playlist Refresh`
- `SOT Competitor Daily Dashboard Sync`
- `SOT Competitor Daily Export`
- `Spotify competitor enrichment`

The three SpotOnTrack workflows regenerate `config/competitor_playlists.csv` from `competitor.labels` / `competitor.playlists` immediately before reading it. DB configuration is the source of truth; the committed CSV is a generated snapshot and outage fallback. The exporter requests exact counts for both tables, checks every Content-Range, and follows server-capped pages by the actual number of rows received. It rejects incomplete reads. Missing playlist rows and absent/inactive labels keep committed CSV rows with warnings; a committed row is removed only when its received playlist explicitly has `is_active = false`. If the DB returns fewer playlists than the snapshot, the entire snapshot is retained. Any DB/read/render/write failure preserves the snapshot, and the regeneration step cannot fail the job. The Spotify competitor enrichment workflow also refreshes missing `competitor.playlists.spotify_playlist_image_url` values before track enrichment.

The SpotOnTrack workflows now chain on success: Playlist Refresh → Dashboard
Sync (after a 10-minute processing wait) → Export. One external
`repository_dispatch` event of type `daily-pipeline` starts both the own-catalog
and competitor refresh heads, with independent concurrency groups and schemas.
Fallback crons remain at 05:23 UTC / 09:23 Dubai (refresh), 08:53 UTC / 12:53
Dubai (sync), and 11:29 UTC / 15:29 Dubai (export); sync/export prechecks prevent
repeat daily work. The competitor ingestion watchdog runs at 14:29 UTC / 18:29
Dubai. Dashboard sync restores competitor state, saves
partial progress, and runs a full sync on Sundays UTC or with manual `full_sync`.
See [Daily pipeline](DAILY-PIPELINE.md) for external scheduler setup, manual-run
behavior, run-date semantics, and failure recovery.

## First-run checklist

1. Start the daily chain with `repository_dispatch: daily-pipeline` (which starts both universes) or wait for the refresh fallback cron. Manual refresh/sync runs do not chain: run refresh, dashboard sync, and export manually in that order.
2. Monitor the competitor dashboard sync workflow as it populates the SpotOnTrack dashboard.
3. Verify the chained competitor export workflow succeeds.
4. Run the Spotify competitor enrichment workflow to fill track metadata and playlist thumbnails.
5. Run `cd web && npm run extract-competitor-accents` for new labels with blank accents after thumbnails are available; use `--force` to re-extract existing/custom accents or changed artwork. Accents are harmonized in `web/src/lib/competitorLabelAccents.ts` (extract script + every label load) so charts, cards, and `--sb-accent` share one resolved hex per label.
6. Switch Settings → Dataset → Competitor Mode.
7. Verify the competitor appears under `/competitors`, Playlists, Catalog, Home, and Search.

## UI surfaces

- `/` — selected competitor overview
- `/playlists` — competitor playlists, totals, current tracks, and daily deltas when history exists
- `/catalog` — competitor artists/tracks
- `/competitors` — competitive intelligence workspace with Overview, Compare, Movement, Catalog intelligence, and Data health views

## Adding another competitor

Apply `migrations/add_competitor_onboarding_config_columns.sql` once, after
`add_competitor_foundation.sql` and `add_competitor_label_accent_hex.sql`. It adds
`sot_dashboard_name` and `min_rows` to `competitor.playlists`, backfills all 17
current CSV rows using generated UPDATE statements, and grants only `service_role`
configuration access. It also defines `competitor.onboard_competitor`, a `SECURITY INVOKER` function with a fixed `pg_catalog, competitor` search path. EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role. Reapplying preserves configured dashboard names and row limits.
Unique indexes enforce playlist/dashboard identity across concurrent submissions,
including inactive rows; existing duplicates must be resolved before applying it.
It creates no public tables and changes no own-catalog workflows. Apply this migration
before using the form; it is not applied automatically by the app or workflows.

1. In SpotOnTrack, open the competitor playlist and create an empty dashboard for it.
2. As an administrator in Competitor Mode, open `/competitors` and click **Add competitor**. Choose a new or existing label, enter names, and paste the Spotify playlist, SpotOnTrack playlist, and dashboard links. Keys are derived from the names and may be overridden. Dashboard name defaults to playlist name; minimum rows defaults to 1.
3. The admin-only `POST /api/competitors/onboard` validates inputs before constructing the service-role client. It rejects existing keys, Spotify/SpotOnTrack playlists and dashboards, writes only `competitor.labels` / `competitor.playlists`, and calls `competitor.onboard_competitor` once via RPC. Label insertion/reactivation and playlist insertion share one transaction: any SQL error rolls back all changes, so there is no client-side compensating deletion or half-created label after a lost response. An identical retry returns HTTP 200 with the existing label and playlist records; a new insertion returns HTTP 201. Retry matching checks every requested playlist field and, for a new label, its name/accent (hex case is ignored); different configuration returns 409. The function serializes concurrent onboarding requests with a competitor-only transaction advisory lock and unique indexes protect identities. Successful writes invalidate only the competitor ops page and selector cache; own-catalog cache tags are untouched. No per-competitor migration or CSV commit is needed.
4. The next refresh picks up the new playlist. Successful non-manual refresh chains to dashboard sync after a 10-minute wait, then export; fallback crons remain 05:23 / 08:53 / 11:29 UTC. To start sooner, run all three manually in order (manual refresh/sync do not chain). Totals appear after ingestion; daily deltas need two snapshots.
5. Run Spotify competitor enrichment to populate thumbnails. If the accent was blank, it is stored as NULL: every label load already calls `applyResolvedLabelAccents` to give it a canonical palette fallback, including harmonization and pinned-brand handling. Then run `cd web && npm run extract-competitor-accents` with the existing Supabase credentials to extract and persist its artwork accent through the same resolver as existing labels. This is an operator step, not an automatic workflow. Provided accents are harmonized at load time too; `--force` intentionally re-extracts all existing/custom accents.
6. Verify `/competitors` and the global competitor selector. Optionally refresh and commit the snapshot with `python scripts/export_competitor_config_from_db.py`; `--check` reports drift and fails on DB errors. `/health` in Competitor Mode distinguishes a stale committed snapshot from rows missing in the DB.

To stop tracking a committed playlist, explicitly set its playlist row to
`is_active = false`; the next verified config excludes it. Disabling only its label
does not remove committed rows: this conservative rule also protects against
missing label responses. Mark each playlist inactive when disabling a label. If generation would produce no rows, the exporter conservatively
keeps the committed snapshot and warns, so disabling the entire universe also requires
stopping its workflows. During DB outages, pipelines continue using the committed
snapshot, which may omit recently onboarded playlists. Keep it current for recovery.

## What the `/competitors` page is for

Competitive intelligence cockpit. Use it to answer:

- **Overview:** Who leads today, who is accelerating, and how rank changes over the latest 30 data dates.
- **Compare:** Absolute, indexed, per-track, and median-growth benchmarks against the own catalog, plus selected-label stream share. Clicking a daily comparison point opens an additive variance waterfall and signed track drivers.
- **Movement:** Latest movers, membership churn, and a 30-day roster-flow diagram. Cross-label flows are inferred only when a label exit and another label entry for the same ISRC occur within three days; unmatched events remain attached to `Outside tracked set`.
- **Catalog intelligence:** Current artist position, artist momentum, release cohorts, and track/artist overlap. Artist and cohort aggregations de-duplicate ISRCs that are present under multiple competitor labels.
- **Data health:** Ingestion success, label-day coverage, anomalous daily values, override dates, and recent warnings. Override counts are read-only diagnostics from `competitor.track_daily_stream_overrides`; raw snapshots are never changed by the workspace.

The heavier Movement and Catalog intelligence payloads are loaded on demand through
the admin-only `/api/competitors/workspace-insights` route. Queries stay in the
`competitor` schema, are bounded to the active labels and latest snapshot/window,
and use the shared Supabase revalidation cache.

For ingestion correctness, use **/health** in Competitor Mode. The page supports:

- **Run scoping:** data-date and label selectors (`?date=`, `?label=`).
- **KPI filters:** stale playlists, row mismatches, missing totals, missing exports, unenriched tracks (`?filter=`).
- **Pipeline status:** per-stage rollup for the selected run.
- **Label summary:** distinct track counts per label (de-duplicated by ISRC).
- **Playlist checks:** stale/mismatch/export flags with raw export links.
- **Warnings:** paginated, severity filter, expandable rows, 30-day history chart (`/api/competitor-health-history`).
- **Unenriched tracks:** paginated drill-down (`?enrich_page=`).
- **Config drift:** compares `config/competitor_playlists.csv` to `competitor.playlists`.

SQL: `migrations/add_competitor_health_enhancements.sql` (distinct track RPC, unenriched paging, warning history MV).

## Missing-day overrides (2026-10-03)

Apply `migrations/fix_competitor_override_only_gap_days.sql` after
`optimize_effective_stream_views_pushdown.sql`, followed by
`optimize_competitor_override_only_gap_projection.sql`. The earlier narrow competitor
view omitted override-only dates. The corrected view includes them without
creating raw snapshots. The projection emits unoverridden raw rows plus every
override once, avoiding partitioned-raw lookups for override-only rows.
The negative-stream RPC uses a windowed predecessor
instead of self-joining the full union history, and still requires consecutive
calendar dates. Existing grants and own-catalog queries are unchanged.

For a missed import, use observed per-ISRC cumulative anchors and write only
`competitor.track_daily_stream_overrides`. Record estimated midpoint values,
flat fills and conservative carry-forwards distinctly in the note. Do not
smooth counter resets or invent histories for newly observed tracks. Recompute
playlist summaries through the latest observed date and revalidate app caches.
Verify the narrow effective view includes the filled date, not merely that
the override table contains rows.

## Intentional omissions

Competitor Mode does not currently include collectors or distributor/entity health logic. Those concepts are specific to the own-catalog universe and should not be half-reused.

Home weekend dips and artificial spike panels require at least two daily competitor snapshots (`hasTrendHistory` on Home). Negative daily streams can appear as soon as competitor track history includes a day-over-day drop.

## Downward counter revisions and re-links (added 2026-08-14)

Two failure modes beyond stale runs, both discovered in the 2026-08-07 Soave
event and now handled automatically each ingestion:

- **Small permanent re-bases** (fraud purges; counter drops a few % and stays
  down): `competitor.spotibase_rebase_downward_revisions` accepts the new
  basis once it has persisted 3+ snapshots and ramps the effective series into
  it over 7 days (`auto-rebase:v1` overrides; manual overrides always win;
  drops >10% are left for review).
- **Re-links** (counter resets to ~zero, possibly restored later): the
  playlist-stats recompute treats any day-over-day swing larger than half the
  counter (>10k) as a data event contributing 0 to `daily_streams_net`, in
  both directions. Per-track effective series remain untouched.

`competitor.spotibase_reconcile_auto_overrides` additionally deletes
auto-interp overrides that upstream corrections have made obsolete (raw now
above the frozen estimate). Order in the nightly normalize step:
reconcile → interpolate → re-base → recompute cascade.
