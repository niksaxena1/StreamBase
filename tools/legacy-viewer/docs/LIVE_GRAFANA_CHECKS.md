# Live Grafana vs offline viewer — spot checks

Run 2026-10-04 against the **live** Grafana instances (signed in by the owner; read-only `SELECT`s via
Grafana's `/api/ds/query`) and the offline archive (`legacy_archive.duckdb`, through
`app/grafana_compat.py`, i.e. exactly what Original dashboards renders). Checksum = row count + sum of
every numeric value in the result.

| Server | Panel | Variables | Live rows / checksum | Offline rows / checksum | Live time | Offline time | Result |
|---|---|---|---|---|---|---|---|
| stats2 | Spotify Dash #75 Releases + Extended: Total | — | [private result omitted] | [private result omitted] | 22.2 s | 0.11 s | ✅ exact |
| stats2 | Spotify Dash #76 Releases + Extended: Daily | — | [private result omitted] | [private result omitted] | 24.8 s | — | ✅ exact |
| stats2 | Spotify Dash #34 Daily Streams: artist – track | Joongle – Dreams | [private result omitted] | [private result omitted] | 0.7 s | 0.09 s | ✅ exact |
| stats2 | Spotify Dash #24 Total Streams: artist | Lone Tusker | [private result omitted] | [private result omitted] | 10.4 s | — | ✅ exact |
| stats2 | Tax V2 #15 ${person}: Total | TG | [private result omitted] | [private result omitted] | 2.2 s | 0.17 s | ✅ exact |
| Playlist followers | All Playlists (daily Σ MAX) | readings ≤ backup time 2026-09-01 14:10:34 | [private result omitted] | [private result omitted] | — | — | ✅ exact |

Also confirmed live: stats2 `tracks` has 34,325,689 rows, last reading 2025-12-22 12:31:38 UTC (= backup);
dashboards Spotify Dash v419 / Tax V2 v64 / Tax (Old) v16 are unchanged since the backup.
Playlist followers has continued collecting after the backup (86,716 rows up to 2026-10-03 20:08 UTC),
which is why its check is cut at the backup timestamp.

Panels that use `NOW()`/`CURRENT_DATE` (e.g. Tax V2 "In" tables' current-month row, milestones "last N
days") differ from live Grafana by design: offline, "now" is anchored to the archive's last observation;
live Grafana evaluates them on today's date, when no new data exists.

The complete offline proof (original SQL in restored PostgreSQL vs DuckDB, 6,641 panel/variable cases,
0 failures) is in `PANEL_VALIDATION.md`.
