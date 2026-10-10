# Original mode verification ? 2026-10-04

All requested implementation and verification steps are complete. Original excluded
SQL / external datasources retain their documented reasons; they are not fabricated.

## Automated checks

* Python: `python -m unittest discover -s app/tests` ? 24 passed, including eight
  original-mode contracts using the real read-only DuckDB archive.
* UI: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` ? passed;
  40 tests across nine files. `node scripts/verify-dist.mjs` also passed.
* The bundle retains a non-blocking Vite >500 KB chunk warning (Recharts included).
* Proof summary: 291 registry ids, 6,641 cases run / passed; packaged summary 33 KB.

## Browser checks

Seven dashboards opened on the owned review server, port 8772. Every row of stats2
Spotify Dash and Tax V2, all differing rows of the other dashboards, and six PF rows
passed: Overview, Playlist Search, Account Search, Ads Running (Usual), Ads Stopped
(JB), K Request. 296 panel cards were checked, including expected exclusion /
consolidation notices; no unexpected error text, NaN/undefined or console errors.

Artist Joongle reloads dependent track options; selecting ...Baby One More Time
reloads the Track panels. The curated Tax Person (12 panels) / Playlist (10 panels)
views passed. Both raw tabs show 100 rows, paginate and download complete CSVs.
Query drawer / validation counts, panel CSV and PNG clipboard actions passed.
Mobile 390px uses one column. Dark theme was inspected. A malicious HTML fixture
retained safe formatting, removed scripts/attributes/media/links, and made zero
remote requests. Custom UTC range endpoints and axis labels were checked; relative
Tax dates remain anchored to the archive when the selected range changes.

## DOM/API numerical comparisons

Five panels matched their API frames. Private sampled values are omitted.

## Five slowest warm panel displays

Milliseconds from scrolling a card into view until its ready element is rendered,
with the row already open. HTTP time separately measures cached response download.
The immutable response's `ms` is the original query measurement, not cache-hit time.
All tested warm displays are below the 2-second target.

| Registry id | Title | Warm browser ms | Warm HTTP ms |
|---|---|---:|---:|
| stats2.spotify-dash.117 | Alert | 386 | 31 |
| pf.playlist-followers.62 | Table | 324 | 6 |
| pf.playlist-followers.3 | All Playlists | 279 | 3 |
| stats2.spotify-dash.55 | Releases | 249 | 8 |
| stats2.spotify-dash.111 | Total Streams: ${artist_name} | 248 | 17 |

Alert's cold query took 3,465 ms / cold visible load 3,881 ms in this run. Large
charts sample display points with extrema/null boundaries preserved; full API /
CSV data are untouched. The plotted numeric time scale uses explicit ticks and
exact selected bounds, avoiding automatic expansion to a following day.

## Package and preservation

`packaging/package.ps1` rebuilt `<repo-root>/.tmp/legacy-package-test/`. The windowed
EXE ran on port 8774 with its bundled database and UI. Dashboards returned seven;
panel, artist options, raw browsing and chunked CSV endpoints returned HTTP 200.
The bundled index matches final ui/dist. Smoke details are outside the package at
`<repo-root>/.tmp/legacy-original-review/exe-smoke.json` to preserve its manifest.
Only owned review processes were stopped. Existing port 8770 was left untouched.

No commits; no compatibility SQL / registry changes or semantic compat bugs found.
Immutable module hashes match the initial isolated review copy:

* `grafana_compat.py`: `9e0df75b562710a13610bff18202d61037669ad8cc6eb87b4490b832b3e141ec`
* The private generated registry was validated before public scrubbing.

Implementation details / intentional rendering limits: [ORIGINAL-MODE.md](ORIGINAL-MODE.md).
Panel CSV serialization streams after compat materializes its transformed frame;
raw CSV streams cursor batches. Hidden unused allTracks retains its archived
current value instead of fetching its 27M duplicate options. Stale empty y spans
are compressed and panel heights extended for readability. Original exclusions,
error parity and documented nondeterministic ordering limits remain in effect.

Machine-readable browser evidence: `ui/output/playwright/original-review.json` and
`original-followups.json`; screenshots in the same directory. Re-run browser review
with PWCLI_JS set to the installed Playwright CLI, LEGACY_API_PORT=8772. Use
RESUME=1 EXTRA_PF=1 for the three additional stamped rows, then RESUME=1 for
`scripts/review-original-followups.mjs`.
