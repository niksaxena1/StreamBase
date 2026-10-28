# Charts universe

Daily snapshots of public music charts. First chart: **Beatport Tech House Top 100**
(`beatport_tech_house_top100`, <https://www.beatport.com/genre/tech-house/11/top-100>).

Charts is a third, fully separate data universe: schema `charts`, its own workflow, its own page
(`/charts`). It never joins `public` or `competitor` analytics tables and does not depend on the
own/competitor dataset switch (the page shows the same content in both modes).

## Source and policy

- `GET` the chart page; the track list is in the `<script id="__NEXT_DATA__">` JSON at
  `props.pageProps.dehydratedState.queries[i].state.data.results` (the query whose results carry
  `isrc`; the script searches, it does not hard-code an index). Position = list index + 1.
- **One plain GET per chart per day**, honest User-Agent
  `StreamBase-ChartSnapshot/1.0 (personal analytics; daily)`. No browser automation, no proxies,
  no header spoofing, no evasion.
- Retries: 3 attempts with 5 s / 20 s backoff on network errors, 5xx and missing data. A 403/429
  is retried at most once.
- Validation before any write: at least 90 entries, unique positions `1..N`, every item has an
  integer id and a name, no duplicate track ids. A chart that fails validation writes nothing and
  the run exits non-zero (failures-only email).

## Schedule

`beatport_chart_snapshot.yml` is `workflow_dispatch` only. pg_cron calls `ops.dispatch_workflow`
daily at **10:00 UTC** (14:00 Abu Dhabi), like the Playlist Watch job. Health lists it under
"Beatport chart" (`SIDE_JOBS` in `web/src/lib/health/pipelineToday.ts`, overdue after 26 h).
The workflow emails only on failure and, after a successful run, pings `/api/revalidate` so the
page refreshes immediately (the page otherwise caches for one hour).

## Tables and RPCs

Migration: `supabase/migrations/20261028031915_charts_beatport_foundation.sql`. All objects are
service-role only; the web app reads them server-side after the normal auth gate (signed in with
own-catalog or competitor access).

| Object | Purpose |
|---|---|
| `charts.charts` | One row per chart (`chart_key`, `source`, `url`, `is_active`) |
| `charts.tracks` | Track metadata, PK `(source, source_track_id)`; `first_seen` is the earliest snapshot date |
| `charts.snapshots` | One row per chart and UTC date (`entry_count`) |
| `charts.entries` | Position of a track in a snapshot; cascades with the snapshot |
| `charts.chart_movement(chart_key, date, compare_days)` | Entries with previous position, change, new/re-entry flags, days on chart, peak |
| `charts.chart_dropouts(chart_key, date, compare_days)` | Tracks on the comparison snapshot that left the chart |
| `charts.track_chart_history(chart_key, source, id, days)` | Daily positions for one track (gaps = off chart) |

`is_new` / `is_reentry` stay false and `compare_date` is null until a snapshot at least
`compare_days` older exists; the page then shows a banner instead of movement.

## Writing a snapshot

`scripts/beatport_chart_snapshot.py` writes in this order: upsert `charts.tracks`
(`first_seen = least(existing, today)`, `last_seen = today`), upsert `charts.snapshots`, delete the
same-day `charts.entries`, insert the entries. A same-day re-run therefore replaces the snapshot.

## Manual run

- Local parse check (no network, no DB): `python scripts/beatport_chart_snapshot.py --dry-run --html-file page.html`
- Real run: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then `python scripts/beatport_chart_snapshot.py`
  (add `--dry-run` to fetch and parse without writing).
- On GitHub: dispatch the "Beatport Chart Snapshot" workflow.
- Tests: `python -m pytest -q scripts/tests/test_beatport_chart_snapshot.py`.

## Adding another chart

If the new page has the same structure (a `__NEXT_DATA__` JSON with a query whose `results` are
tracks with `isrc`), insert a row into `charts.charts` with `source = 'beatport'`, a new
`chart_key`, `display_name`, `genre_name` and the chart `url`. The script loops over all active
`beatport` rows, so no code change is needed for the snapshots. The `/charts` page currently
renders `beatport_tech_house_top100` only (`BEATPORT_TECH_HOUSE_KEY` in
`web/src/lib/charts/chartsModel.ts`); showing several charts needs a chart selector there.
A different structure or another site needs a new parser module and a new `source` value.
