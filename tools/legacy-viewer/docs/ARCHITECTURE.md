# StreamBase Legacy Archive Viewer — architecture & data semantics

Status: v2 design, 2026-10-04. Supersedes the first-pass prototype (stdlib server + SQLite over the
reconciled canonical CSV). This file is the contract every build/UI/validation component follows.

## 1. What the archive actually contains (verified 2026-10-04)

| Source | File | Restored contents | Notes |
|---|---|---|---|
| stats2 (PG 16.9) | `stats2…/live-server-backup/<streams-current-dump>` (2026-09-01) | `tracks` 34,325,689 rows, 2023-07-08 04:51 → 2025-12-22 12:31 UTC; `milestones` 15,705; `artists` 1,357; `songs_by_artist` 2,756; `_ev` 13 | Row count equals the live server today (collection stopped 2025-12-22 although cron is still armed). `_ev` holds the postgres process environment → evidence of `COPY … FROM PROGRAM` (server compromise). Not shown in the app except as a security note. |
| stats (PG 14.8) | `stats…/postgresql/<streams-older-dump>` (2025-03-13) | `tracks` 27,198,862 rows → 2025-03-10 08:35; `milestones` 10,543 | **Every row is byte-identical (same id and all columns) in stats2.** The stats dataset is therefore an exact subset of stats2 (`in_stats_dump` flag), not separate history. |
| stats live cluster (recovery clone <reference-host>) | raw PG14 cluster inside `full-root-filesystem.tar.gz` | not yet extracted | Reported ~29.9M rows → 2025-06-04. stats2 has gaps 2025-03-10→03-16 and 2025-06-04→06-14, so the clone may hold ~6 days found nowhere else. Pending read-only comparison via clone Grafana. |
| Playlist followers (PG 15.7) | `Playlist followers/…/<followers-dump>` (2026-09-01) | `spotify_followers` 2,710,108 rows, 905 playlists, 49 accounts, 2024-04-07 → 2026-09-01 | **Still collecting live** (894 playlists, 3 readings/day). Owner decision: collection moves to StreamBase (separate project). |
| Grafana | three `grafana.db` + dashboard JSON | stats2: Spotify Dash v419, Tax V2 v64, Tax (Old) v16 (identical to live). stats: Spotify Dash v385, Tax V2 v47, Tax (Old) v16. PF: Playlist Followers v563 | Owner uses (starred): **stats2 Spotify Dash, stats2 Tax V2, Playlist Followers**. Tax (Old) and stats-server versions are secondary. |
| Reconciliation extract | `stats2…/previous-streambase-extract/` | spotify_track_id → ISRC map (3,209 ids, 100%), canonical ISRC/day, catalog daily | Reused only for the ISRC map and as a cross-check, not as the source of truth. |

All timestamps are `timestamp without time zone` written in UTC (server TimeZone `Etc/UTC`). Grafana
displayed them in the browser timezone (UAE, +04). **A "day" is a UTC calendar day everywhere in this
app** (identical to Grafana's `DATE(created_at)`), shown as a plain date without a time.

## 2. Measurement semantics (why there are several "truths")

The collector read each playlist several times a day and readings were unreliable, so the owner's rule
was: *the most frequently occurring reading in a period is the truth*. The Grafana SQL implements three
different families of that rule. They legitimately produce different numbers and each must be kept
where the original panel used it.

- **F1 Track-day mode** — per (UTC day, `spotify_track_id`): mode of `play_count`, tie → higher
  `play_count`. Totals = SUM of modes. Used by: Artist/Track panels (artist panels group by `song_name`
  instead of id), Tax "In"/monthly tables, prior reconciliation extract.
- **F2 Playlist hourly-total mode** — per (playlist, hour): SUM(play_count) of all rows; per (playlist,
  UTC day): mode of those hourly totals (tie → higher; some Tax panels keep *all* tied values via
  `MAX(freq)` join, which can double rows — reproduce exactly in Original mode and flag). Group totals =
  SUM over playlists. Used by: Overview, Individual Playlists, Monthly Data, Tax person/playlist totals.
- **F3 Hourly max** — per (hour, track): MAX(play_count), summed. Hourly diagnostic rows only.
- **Monthly "In" (Tax)** — month value = (total on day 2 of next month) − (total on day 2 of this
  month), current month uses the latest day; `Est. Revenue = streams × 0.002` (hard-coded rate, kept
  verbatim and labelled as such).
- Daily change = difference to the *previous row*, not the previous calendar day. Grafana therefore
  attributes multi-day gaps to one day. The Explorer shows gap-spanning deltas as gaps (null), see §4.

## 3. Architecture decision

**A portable local web app: one Windows EXE (PyInstaller, Python + DuckDB embedded) serving a static
React UI on 127.0.0.1, over one read-only DuckDB file that contains the raw observations.**

Why:
- Raw data fits: all 34.3M stream observations + 2.7M follower readings = ~430 MB DuckDB. Full-catalog
  F1 for every day runs in 0.7 s; one track in 0.07 s. Shipping raw rows means every Grafana panel,
  including hourly/diagnostic ones, can be recomputed exactly instead of approximated.
- **Two modes in one app (hybrid):**
  1. *Explorer* — StreamBase-style pages (Overview, Tracks, Playlists, Milestones, Tax, Followers,
     Data quality, Archive) built on precomputed derived tables keyed by ISRC where identity matters.
  2. *Original dashboards* — every meaningful Grafana panel, re-run on DuckDB with a faithful SQL
     translation, same variables, same transformations. Each translation is proven equal to the
     original SQL executed in PostgreSQL (§6).
- Rejected: portable PostgreSQL+Grafana bundle (would ship datasource credentials/config, two servers
  to start, ~1 GB+, Grafana version lock); SQLite-only (forces precomputing hourly views, slower window
  functions); Electron/Tauri (bigger, adds Node/Rust toolchain; the browser app-window gives the same
  feel).
- Launch: double-click `StreamBase Legacy Viewer.exe` → server on a free 127.0.0.1 port → opens Edge in
  `--app` window mode (fallback: default browser). Stop: Quit button in the app (token-protected
  shutdown) or `Stop Legacy Viewer.cmd`. No network access besides loopback; no CDN, fonts are bundled.
- Build-time only tools (never shipped): portable PostgreSQL 17.11 in `<repo-root>\.tmp\pgsql`, the
  project venv `<repo-root>\.tmp\legacy-viewer-venv` (duckdb, psycopg, pyinstaller), Node for the UI build.
- Security: nothing from `application_and_config.tar.gz`, `grafana.ini`, datasource rows,
  `postgresql_globals.sql`, TLS material or `_ev` is copied into the package. Only table data and
  dashboard *definitions* (SQL, titles, layout) are used.

## 4. Derived data model (DuckDB `legacy_archive.duckdb`)

Raw (verbatim from dumps): `src_tracks` (+ `in_stats_dump BOOLEAN`), `src_milestones` (+ `in_stats_dump`),
`src_artists`, `src_songs_by_artist`, `pf_followers`.

Reference: `meta(key, value)` (build time, source SHA-256s, row counts, date ranges, tool versions),
`isrc_map(spotify_track_id, isrc, match_method)`, `playlists(playlist_id, name, short_name, owner, groups[])`
from the dashboard definitions, `track_identity(spotify_track_id, isrc, song_name, artist, playlists[],
first_day, last_day)`, `grafana_panels` (registry, §6).

Derived:
- `track_day` (F1): day, spotify_track_id, isrc, streams (mode), mode_frequency, observation_count,
  distinct_play_counts, mode_confidence, first_obs, last_obs, prev_day, delta (streams − previous
  observed day's streams **only if prev_day = day − 1**, else NULL), is_reset (delta < 0).
- `isrc_day`: day, isrc, streams = MAX over spotify ids of the same ISRC (linked/re-released ids carry
  the same counter; summing double counts — Grafana's name-based track panels sum them, quantified in
  VALIDATION), source_ids, delta with the same consecutive-day rule, reset handling: negative delta →
  delta NULL + is_reset.
- `playlist_day` (F2): day, playlist_id, total_mode, hours_observed, tracks_observed.
- `playlist_track_day`: day, playlist_id, spotify_track_id (membership).
- `catalog_day`: day, tracks, streams (Σ isrc_day), daily_net (Σ non-null deltas), tracks_with_delta,
  resets, missing_prev, coverage flag (NULL daily_net when >10% of tracks lack a consecutive prior day).
- `pf_playlist_day`: day, playlist_id, followers_max (Grafana daily rule), followers_last, readings,
  zero_readings, null_readings. `pf_playlists`: playlist_id, name(s), account, user_id, first/last,
  dashboard groups (Ads Running/Stopped × Usual/Group A/JB, K Request).

Rules: missing ≠ zero (NULL stays NULL); never interpolate; resets are flagged, not hidden.

### Explorer measurement decisions (2026-10-04, from data review — Original dashboards keep Grafana's exact rules)

| Topic | Grafana behaviour | Explorer behaviour | Evidence |
|---|---|---|---|
| Playlist totals | F2: mode of hourly SUM of all rows | Σ of member tracks' F1 daily modes (`playlist_day.total_track_mode`) | Equal on 9,524/10,002 stats2 playlist-days, within 0.1% on 9,845; 4 gross outliers where the collector scraped a playlist twice in one hour (e.g. Extended 2025-07-11: F2 495.9M vs 249.5M) |
| Playlist-group days | Sums whichever member playlists reported | Day is blank unless every member playlist active at the time reported | Releases+Extended: 9 partial days produced ±1.2B swings |
| Follower daily value | Daily MAX | Daily MODE of readings, tie → higher (`pf_playlist_day.followers_mode`) | MODE = MAX on 689,962/740,650 playlist-days; the only gross gap is 2025-01-09 ≈16:00 UTC when readings were stored under neighbouring playlists (139 playlists inflated, up to +215k) |
| Follower daily change | Difference of consecutive totals | Like-for-like: Σ per-playlist change for playlists reporting on both consecutive days | 87 of 878 days have <100% of active playlists reporting |
| "Gained in range" (catalog) | n/a | Σ of each ISRC's own growth; raw catalog-total change shown separately | H1 2025: 387.4M per-track growth vs 750.7M catalog-total change (tracks entering tracking with existing counters) |
| Playlist "change in total" | LAG over rows | Kept as a playlist-total change and labelled as including membership changes | — |
| Daily change charts | LAG over rows (spans gaps) | `net` only between consecutive UTC days; gaps render as gaps | — |

## 5. UI

The default start page is now **Track lookup** (`#/lookup`): artist → track →
two UTC readings → their difference. Its calculator and monthly table use the
owner's endpoint-reading definitions, independent of Explorer gained-in-range
and Tax/Grafana monthly rules. See [TRACK-LOOKUP.md](TRACK-LOOKUP.md) for the
reading fallback, empty-span, monthly flags, API/CSV and verification contracts.
Lookup has its own bounded date inputs, so global dates/grain are hidden there.
Navigation groups lookup, Explore, Reports, Original dashboards and About the
data. Existing Explorer measurements are unchanged.

React + TypeScript + Vite + Recharts + Tailwind v4, StreamBase tokens copied from
`web/src/app/globals.css` (`--sb-*`, light + dark), Inter / Space Grotesk / Geist Mono bundled locally.
Shell: left nav (Overview · Tracks · Playlists · Milestones · Tax · Followers · Original dashboards ·
Data quality · Archive), top bar with dataset switcher (stats2 complete · stats server subset ·
Playlist followers), global date range + resolution (daily/weekly/monthly), CSV export of the current
filtered result, keyboard-accessible controls, explicit loading/empty/error states.

## 6. Fidelity & validation

Original dashboards, curated Tax V2 and raw observation/readings browsers are
implemented separately from Explorer analytics. See [ORIGINAL-MODE.md](ORIGINAL-MODE.md)
for HTTP contracts, rendering limits, offline text handling and review commands.
`api_original.py` calls the validated compatibility runner; it does not replace
the SQL or the Explorer decisions above.

`grafana_panels` registry: one entry per original panel (server, dashboard, version, row, panel id,
title, type, variables, original SQL, DuckDB SQL, transformations, status =
implemented | consolidated(→feature) | excluded(reason)). Validation runs the original SQL in the
restored PostgreSQL and the DuckDB translation for every variable-free panel and a stratified sample
of variable values (all persons/playlists; ≥150 artists and ≥300 tracks incl. hard cases), and
requires exact equality (numeric tolerance 0). Explorer numbers are cross-checked against the panel
they replace; every intentional difference is listed with its size. Relative-time panels (`NOW()`)
are anchored to the dataset's last observation, documented.

Round 3 (quick jump, availability calendar, artist range report, counter-source switch warnings, app identity, wide layout):
see the "Round 3" section of [TRACK-LOOKUP.md](TRACK-LOOKUP.md). Server-side: `Lookup.compare()` is the single From/To
computation behind `/api/lookup/between` and `/api/lookup/artist-report`; `server.py` opens the Edge app window at a clamped
1600x1000 (`window_geometry`).
