# Track lookup

The start page is `#/lookup`. Choose an artist, choose one of their ISRC tracks,
and compare two UTC counter readings on one screen. Quick find also accepts an
ISRC, a Spotify ID/link, or `artist – track`. Track, dataset, artist selection,
From and To are bookmarkable; Back/Forward restores them. The last eight tracks
are stored locally, with storage failures handled without blocking lookup.

## Measurements

- Identity is an ISRC. A daily counter is `isrc_day.streams` for the selected
  dataset: per-ID daily mode, highest counter across linked Spotify IDs.
- `reading(D)` uses a row on UTC day D, otherwise the latest earlier row. A
  substitution includes `used_day` and `substituted=true`. Before tracking it
  uses the first later row and also sets `before_tracking=true`.
- Difference is `reading(To) − reading(From)`. It excludes From-day's own
  streams. No interpolation and no missing-to-zero conversion.
- Elapsed days use the two **used** dates. Per day is difference / elapsed
  days, or null when both endpoints resolve to the same reading.
- Resets are the `is_reset` dates in `(used_from_day, used_to_day]`. `gap_days`
  counts missing calendar days inside those endpoints. A reset is retained in
  the difference and explained; gap-spanning deltas are not invented.
- If no reading exists anywhere in the requested inclusive span, `empty=true`
  and difference/per-day are null. Resolved endpoints are still returned when
  history exists, so substitutions can be explained. An ISRC absent from the
  selected dataset returns this empty contract; an unknown ISRC returns 404.
- A reversed range is 400. Date inputs enforce track bounds; bookmarked/API
  ranges may extend outside tracking to expose the before-tracking flags.

Presets anchor to the track's last archived reading. Last 7/30 days means 7/30
**elapsed** days. Previous month and the month picker use first/last calendar
dates, clipped to the track's bounds. A previous month wholly before tracking
clips to the first day. Whole history uses first/last tracked dates.

## Monthly table

`streams_in_month = reading(month end) − reading(previous month end)`.
End total and both resolved readings are included. The first tracked month
starts at the first reading (`partial_first_month`); the final month stops at
the last reading (`partial_last_month` when before calendar month end).
Substituted endpoints, resets and missing-day counts have badges and tooltips.
Months without observations retain the same reading rule and carry flags.

Clicking a month compares its **first and last dates** in the calculator, as
requested by the owner. The monthly table uses the previous month-end baseline;
the tooltip and caption explain this one-day difference in measurement.
The chart keeps gaps, shades the selected dates, and marks the used readings.
Click two readings (either order), or drag across readings to select both.
Daily change bars preserve the existing consecutive-day delta/reset rules.

## Read-only API

All lookup endpoints default to `dataset=stats2`; `stats` is the only other
dataset. Lookup never changes the DuckDB file, builder, Grafana compatibility
runner, existing Explorer analytics, or either StreamBase analytics schema.

| Endpoint | Parameters | Result |
| --- | --- | --- |
| `/api/lookup/artists` | `dataset`, optional `q` | `rows`: name, track_count, latest_total; only artists with tracks; name sorted; accent/case-insensitive search |
| `/api/lookup/tracks` | `dataset`, `artist` | `rows`: isrc, song_name, full artist credit, first_day, last_day, latest_streams; exact comma-split membership; latest descending |
| `/api/lookup/between` | `dataset`, `isrc`, `from`, `to` | track, from/to readings, difference, days, per_day, reset dates, gap_days, empty |
| `/api/lookup/monthly` | `dataset`, `isrc` | track bounds, monthly rows with flags, daily readings with observations/confidence/flags, empty |
| `/api/export` | `dataset`, `isrc`, `view=lookup_monthly` | Flattened monthly readings, totals and flags as CSV |
| `/api/export` | `dataset`, `isrc`, `view=lookup_daily` | All daily readings, observations, confidence, reset/disagreement/gap flags as CSV |

Immutable summaries are cached per dataset in the lookup service. A bounded
128-track history cache serves the calculator/table; it does not change
Explorer caches or query plans. HTTP queries remain parameterized.

## Verification

Run the commands in the root README. `app/tests/test_lookup.py` uses the real
read-only DB and direct SQL for the Joongle Dreams example, both datasets,
reading flags, resets, gaps, CSVs and monthly telescoping identity.
`ui/src/lib/lookup.test.ts` covers UTC presets (including leap February),
reversed point selection, copy formatting and warning text.
The API sweep checks 30 artists' complete track lists and 50 track histories
per dataset, with exact, gap, reset, zero-day and pre-tracking ranges. It reports
warm lookup latency separately from the Original-dashboard timings.

2026-10-04 verification: 32 Python tests, 49 UI tests; typecheck/lint/build/offline
audit passed. Sweep: 4,725 requests, 0 failures; slowest warm lookup was monthly
for `stats2 / SE5BU2263233`, 21.0 ms. After round 3: 51 Python tests, 112 UI tests; sweep
5,389 requests (adds the days endpoint for 50 tracks per dataset, the artist report for 30 artists
x 3 ranges per dataset, search), 0 failures, slowest warm lookup request 28.4 ms. Mouse and keyboard-only flows, real clipboard
text, Back/Forward, and no horizontal overflow passed at 1600×1000 and 1280×720,
in light and dark mode. Screenshots and verification reports are in
`<repo-root>\.tmp\legacy-build\lookup-screens\` and the parent build folder.

## Artwork, picker order, milestones (polish)

- `/api/lookup/tracks` rows are now sorted **alphabetically by title** (case/accent-insensitive,
  then exact title, then ISRC); they keep `first_day` and the full `artist` credit so the picker can
  disambiguate same-title tracks (differing credit, else "first seen YYYY"). The picker shows cover +
  title only.
- Every track/artist payload (`/api/lookup/artists|tracks|monthly`, `/api/tracks`, `/api/explorer/tracks`,
  `/api/track/{isrc}` identity, `/api/artists`, `/api/artist/{name}`, playlist tracks) carries `art`:
  a relative URL (`art/tracks/<isrc>.jpg`, `art/artists/<id>.jpg`) or `null` (UI shows an initials tile).
  `/api/lookup/monthly` also returns `track.artists: [{name, art}]`.
- `/api/lookup/monthly` returns `milestones: [{day, milestone, play_count}]`, matched exactly as the
  Explorer track detail does (song_name + artist variants of the ISRC; `in_stats_dump` for `stats`).
  The chart draws one labelled flag per date; same-day milestones share a flag ("250K +2").
  Milestones logged on the first tracked day were recorded when tracking began.
- Chart extras (view only, never change the calculator): zoom (All/1y/90d/30d/Selection), Sat/Sun
  weekend bands at daily grain (<=450 days in view; toggle remembered), 7-day avg line (needs 4 known
  days, same rule as the API MA7), monthly bar chart (amber = month has reading notes; click = table row).
- Two-click selection: first click sets From, second sets To (swapped when earlier); drag still selects both.

## Artwork pipeline

`python build\fetch_artwork.py [--db PATH] [--art DIR]` (run while no viewer holds the DB) reads
StreamBase `tracks` / `spotify_artist_images` read-only via `web\.env.local` (key used only as an HTTP
header), downloads 64px covers and 160px artist photos from i.scdn.co into
`.tmp\legacy-build\art\{tracks,artists}`, and writes `art_tracks` / `art_artists` into the DuckDB.
`build_all.py --skip-artwork` omits it. The server serves `/art/*.jpg` from `--art` (default
`<package>\art`); `package.ps1` copies the folder (`-ArtSource`). No art folder = initials tiles.

## Round 3: quick jump, calendar, artist report, source switches

**Endpoints** (all read-only, `dataset=stats2|stats`):

| Endpoint | Parameters | Result |
| --- | --- | --- |
| `/api/lookup/days` | `isrc` | `ranges`: inclusive `[first, last]` runs of consecutive days that have a reading (feeds the calendar), plus `first_day`/`last_day` |
| `/api/lookup/artist-report` | `artist`, `from`, `to` | one row per track credited to the artist (comma-split credit): `track`, `from`, `to`, `difference`, `days`, `per_day`, `resets`, `gap_days`, `empty`, `source_switches`; `total` (sum of non-null differences), `counted_tracks`, `excluded_tracks` |
| `/api/lookup/search` | `q` | quick-jump candidates: `tracks` (title, credit, ISRC, Spotify ID; max 300) and `artists`; the UI ranks them |
| `/api/export` | `view=artist_report`, `artist`, `from`, `to` | the report as CSV |

- **One computation.** `/between` and every artist-report row call the same `compare()` in `api_lookup.py` over the same
  `reading()` rule; the report only bulk-loads the histories (one query for all member ISRCs). Tests prove each row equals
  `/between` for its ISRC and the total equals the sum. A track with no reading in the range has `difference = null`, shows
  "—" and is left out of the total (never zero). Collaboration tracks count fully for each credited artist, so totals of
  different artists overlap; substituted/before-tracking readings are included and flagged.
- **Counter-source switches.** `isrc_day.selected_spotify_track_id` can change over time when an ISRC has several Spotify IDs with
  separate counters (the numbers keep the owner's "highest of linked IDs" rule). `source_switches: [{day, from_id, to_id, jump}]`
  lists every change between the two used days, `(used_from_day, used_to_day]`; `jump = streams(day) - streams(previous reading)`.
  `/monthly` carries the same list per month and for the whole track, and a `source_switch` daily flag (distinct from
  `linked_ids_disagree`). Example: Joongle "Dreams" (SE6QE2204745) switched from `5p3RtNFD…` to `4oUnsT67…` on 2025-07-17,
  jump +363,323, so July 2025 (+369,562) is mostly that jump. IDs trade places constantly (8,824 switches in stats2, median
  |jump| 189), so the UI only warns about |jump| >= 1,000 (`NOTABLE_SWITCH_JUMP`) and counts the rest as "minor".
- **Milestone flags** on the lookup chart now come from the track's own series (`ownMilestones`): the first reading with
  streams >= 100K, 150K, 200K, 250K, 300K, 400K, 500K, 600K, 700K, 750K, 800K, 900K, 1M, 1.5M, 2M, 2.5M, 3M, 4M, 5M, 6M, 7M,
  8M, 9M, 10M and every further 5M; thresholds already exceeded at the first reading are listed in a note instead. The old
  name-matched `milestones` field is still returned and the Milestones page and Original dashboards are unchanged.

**UI.** Ctrl/Cmd+K opens the quick jump anywhere (tracks and artists, accent/case-insensitive, prefix first; Enter opens the
track keeping the current or last From/To, or the artist in Track lookup). The calendar popovers mark days with a reading, gap
days and days outside tracking; typing a date still works. `[ ] / Shift+[ Shift+] / / / t / c / ?` are the lookup shortcuts
(ignored while typing or while a dialog is open). The last lookup is remembered (localStorage) and reopened when the app
starts without a route. Numbers can be shown Exact (default) or Compact in the top bar; compact values carry the exact value in
a tooltip. At 1400px and wider Track lookup uses two columns; a sticky bar keeps the track and result in view.
