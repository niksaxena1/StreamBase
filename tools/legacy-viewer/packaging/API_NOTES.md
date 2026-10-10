# Legacy API implementation notes

`app/server.py` accepts `--db`, `--ui`, `--port`, and `--no-browser`. Source startup requires an explicit `--db` path and uses `ui/dist`; frozen defaults
are `data/legacy_archive.duckdb` and `ui` next to the EXE. Binding is IPv4 loopback
only. On Windows, a named kernel mutex serializes startup, and `.viewer.json`
identifies the live process with its port, PID and session token. Idle HTTP
connections time out after five seconds so they cannot prevent token shutdown.

All analytics use one read-only DuckDB instance with a separate cursor per
request. No raw/archive contents are changed at runtime. The inventory builder
must run with all readers closed; it replaces only `archive_inventory`.

## Dates, counters and missing data

- `dataset`: `stats2` (default) or `stats`. Followers have independent bounds.
- Inclusive `from`/`to` are UTC dates. Defaults are the selected dataset bounds.
- `grain`: day, ISO Monday week, or month. Bucket dates denote the bucket start;
  `*_day` fields identify the last non-null cumulative value's actual UTC date.
- Daily/net bucket values sum only non-null deltas. All-null buckets stay NULL.
  `days_with_data`/`days_missing` count usable daily values; separate
  `counter_days_with_data`/`counter_days_missing` describe cumulative observations.
- MA7 includes six earlier calendar dates, even before the selected range, and
  requires at least four non-null daily values. It is NULL for week/month grains.
- Range gain uses the last known value on/before `to` minus the last known value
  before `from`; when no earlier counter exists, it subtracts the first known
  counter inside the range and sets `started_in_range`. No zero baseline is used.
- Track `avg_daily` divides gain by calendar dates elapsed from the requested
  previous-day boundary (or the first in-range observation for a new track) to
  the final counter observation, with a minimum denominator of one.
- Track identity is ISRC; linked IDs use MAX. Artist table totals sum member
  ISRC latest values, which can have different reporting dates. Artist detail
  week/month counters sum each member's last non-null value inside the bucket;
  changing or partial membership is explicitly noted.
- Playlist F2 totals use the precomputed hourly-total mode, summed over the
  selected playlists. `daily_change` uses the previous observed row, including
  gaps; `net` requires the preceding calendar day. Bucket membership counts the
  distinct Spotify IDs observed anywhere within that bucket and selected scope.
- Followers use per-playlist UTC daily MAX, summed for the aggregate. The latest
  KPI additionally sums each playlist's own most recent non-null daily MAX.

## Filters and export

Track search normalizes case/accents and Scandinavian stroked letters (`ø`, `ł`)
across song, artist, ISRC and Spotify IDs. Artist filters match exact trimmed
members of comma-separated names. Sort identifiers/direction use whitelists;
all user data is bound as SQL parameters. Pagination defaults to 100, max 5000.

`/api/export?view=...` ignores pagination and streams fetchmany batches as UTF-8
CSV with BOM. Entity export selectors are `isrc` for track/track_records, `name`
(or `artist`) for artist, and `id` (or `playlist`) for playlist/followers_playlist.
Track export normally emits the plotted series. `view=track&day=YYYY-MM-DD`
exports every raw reading on that day; `view=track&raw=1` exports every raw reading
in the selected range, including the selected per-ID mode, without the JSON
readings endpoint's 5000-row cap. NULL CSV fields are empty; lists/structs use JSON.

`exclude_lofi=1` implements the exact original SQL predicate, case-insensitive:

```sql
artist NOT ILIKE '%Joongle%' AND artist NOT ILIKE '%DOSA%' AND
artist NOT ILIKE '%Piple%' AND artist NOT ILIKE '%sad app%' AND
artist NOT ILIKE '%tsambar%' AND artist NOT ILIKE '%dokha%' AND
artist NOT ILIKE '%five fi%'
```

The milestone latest flag is evaluated over the selected dataset before filters.
The ladder counts distinct song/artist pairs at each recorded milestone and sorts
numerically. Inventory dump table/row-count summaries come from verified build
meta; configuration, secret, filesystem and dump contents are never opened by
the inventory builder (the checksum manifest itself is the only archive text read).

## Verification commands

```powershell
.tmp/legacy-viewer-venv/Scripts/python.exe tools/legacy-viewer/build/archive_inventory.py
.tmp/legacy-viewer-venv/Scripts/python.exe -m unittest discover -s tools/legacy-viewer/app/tests -p test_api.py -v
.tmp/legacy-viewer-venv/Scripts/python.exe tools/legacy-viewer/app/tests/measure_latency.py
.tmp/legacy-viewer-venv/Scripts/python.exe tools/legacy-viewer/app/tests/smoke_process.py
powershell -File tools/legacy-viewer/packaging/package.ps1 -Destination "<package-root>" -Python "<python-executable>" -Database "<private-duckdb-path>"
.tmp/legacy-viewer-venv/Scripts/python.exe tools/legacy-viewer/app/tests/smoke_process.py --exe ".tmp/legacy-package-test/StreamBase Legacy Viewer.exe" --output .tmp/legacy-build/api_frozen_smoke.json
```

The latency script measures a new read-only database/service per endpoint, followed
by a warm invocation, including JSON encoding/full CSV drain. It does not flush
Windows filesystem caches or include process startup. The process smoke separately
uses actual `curl.exe` HTTP requests, exercises occupied-port fallback, a second
launch, Host rejection and token shutdown. Grafana compatibility module/registry
and UI development belong to the concurrent worker and remain untouched here.
