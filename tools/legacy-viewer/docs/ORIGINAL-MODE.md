# Original dashboards, Tax and raw archive browsing

Original mode (`#/original?dash=stats2.spotify-dash`) reproduces the registry's
seven dashboards. `#/original-dashboards` remains an alias. The owner-used
dashboards are starred. The older stats dashboards contain only differing
panels and show the registry's identical-panel count with a link to stats2.

`var-<name>` parameters preserve string values; multi-values use JSON arrays.
`from` and `to` accept ISO UTC timestamps, UTC dates, or archive-relative values
such as `now-1y` and `now`. Months and years use calendar arithmetic. Each
dashboard's dataset anchor defines now. SQL frames are kept exactly as returned
by `grafana_compat.run_panel`; charts clip the x axis to the selected range.
Tables and stats retain the original query's own time rules.
Large time-series charts sample display observations to about 2,500 points,
retaining bucket extrema, endpoints and every null boundary. A panel note makes
sampling explicit; API frames, tables, reducers and CSV data remain unchanged.
Highly fragmented null gaps can exceed that display budget to preserve gaps.

Collapsed rows are saved locally per dashboard/row. Closed rows have no mounted
panels; an IntersectionObserver gates panel requests. The archived x/width and
vertical relationships are retained on a 24-column grid with 30px height units.
Stale blank y spans in collapsed Grafana definitions are compressed; small cells
are extended for readability. Under 1024px panels become a single column.

The curated Tax page uses only stats2 Tax V2 registry panels. Revenue is explicitly
labelled as the original streams × 0.002 estimate, not accounting data. Person
membership comes from the custom variable and playlist options. Daily tied
modes, gap-spanning deltas and monthly day-2 snapshots retain their original
semantics. Registry quirks accompany the curated panels.

## HTTP endpoints

* `/api/original/dashboards`: SQL-free dashboard metadata, variables and expanded
panel instances. Field configuration/options needed for rendering are included.
* `/api/original/variable-options?dashboard=&name=&vars=<json>`: compat's parsed
  custom options or translated query options with dependency values and defaults.
  The UI retains archived defaults for hidden variables that no control depends
  on. In particular the older stats Spotify allTracks query is unused by panels
  and returns 27M duplicate options; it is not automatically fetched.
* `/api/original/panel?id=&instance=&vars=&from=&to=`: compat frames, elapsed query
  time, visible SQL target refs, quirks, validation, truncation and resolved range.
  For follower templates `instance` is the original instance's numeric panel_id.
* `/api/original/panel-sql?id=`: original/translated SQL, translation rules,
  nondeterminism notes, status reason and validation counts.
* `/api/export?view=original_panel&id=&instance=&vars=&from=&to=&ref=`: first frame
  or first frame with the selected target ref, serialized as chunked UTF-8 CSV.
* `/api/raw/observations?dataset=&from=&to=&playlist=&q=&spotify_id=&sort=&dir=&limit=&offset=`.
* `/api/raw/follower-readings?from=&to=&playlist=&account=&q=&sort=&dir=&limit=&offset=`.
  Raw exports use `view=raw_observations` / `view=raw_follower_readings` and the
  same filters, ignoring pagination.

Raw ranges default to the last seven UTC archive dates (inclusive), and are
limited to 367 dates. Timestamp predicates avoid casting the stored columns,
allowing DuckDB zone-map pruning on the ordered archive. There are no physical
ART indexes in the supplied archive; no database/index mutations are needed.
Exact counts respect the same filters. Stats observations add `in_stats_dump`.
Raw export reads bounded fetchmany batches; panel export must first materialize
the full compat frame because the validated runner applies transformations in
memory. CSV serialization streams and does not build a completed CSV in memory.
The browser caps each frame at 50,000 rows; export includes the complete frame.

`build/summarize_validation.py` packages all registry panel ids into
`app/panel_validation_summary.json` (33 KB), aggregating target outcomes and
notes. Pass includes the documented unordered/tiebreak/Unicode/error-parity
categories; it is not a claim that every possible input produces an ordered,
successful query. The original failing SQL/datasources stay explicitly excluded.
The compat module, registry, original SQL and translations are unchanged.

The panel LRU holds up to 200 entries, keyed by panel, instance, effective
variables and normalized UTC range. Hits reuse the identical payload, including
its original measured query time. A separate lock bounds expensive misses;
cached responses do not wait behind a cold query. Explorer reads remain separate.

Text rendering allows formatting elements only and discards all attributes,
scripts, style, embeds and media. External links are shown as text and remote
images are never inserted or fetched. Charts, fonts and dependencies stay local.

## Verification

Run the Python unittest suite and UI typecheck/lint/test/build as in the task.
`ui/scripts/review-original.mjs` drives the Playwright CLI (set `PWCLI_JS`) against
`LEGACY_API_PORT` (default 8772), recording row/panel checks and warm timings in
`ui/output/playwright/original-review.json`. Review servers need an isolated app
copy so the server's single-instance mutex does not reuse a running review app.
Stop only the review server you started, using its loopback session token.
