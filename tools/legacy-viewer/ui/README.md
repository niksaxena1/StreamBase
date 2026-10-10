# StreamBase Legacy Archive UI

Offline Vite / React 19 / TypeScript foundation, served by the Python viewer on loopback.
The default route is `#/lookup`: a fast artist/track picker and streams-between-dates
calculator with recent tracks, keyboard navigation, a selectable gap-preserving
chart, monthly table and CSVs. It uses its own track-bounded UTC dates; the shell's
global range/grain are hidden on this page. [Lookup contracts](../docs/TRACK-LOOKUP.md)
cover endpoint readings and monthly baselines (separate from Explorer/Tax rules).
Explorer pages use the local archive API: Overview, Tracks/Track, Artists/Artist,
Playlists/Playlist (including six-playlist comparison), Milestones, Followers/Follower
playlist, Data quality, and Archive. Tax and Original dashboards remain placeholders.
Only the development gallery has synthetic data.

Run `npm install`, `npm run dev` (the `/api` proxy targets port 8765). If the API
chooses a different port, set `$env:LEGACY_API_PORT='PORT'` before starting Vite.
The proxy rewrites Host to the loopback API origin, as required by the server guard. Open
`#/__gallery` for every primitive, both themes, and the null/gap/reset chart examples.
Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, then
`node scripts/verify-dist.mjs`. Ship **only `dist/`** with the Python viewer.
Production has relative assets and hash navigation; it does not contain the gallery.

Round 3 additions: Ctrl/Cmd+K quick jump (`components/CommandPalette.tsx`, ranking in `lib/palette.ts`), calendar date
picker with data availability (`components/ui/DayPicker.tsx`, `lib/calendar.ts`), lookup shortcuts (`lib/shortcuts.ts`),
Artist report page (`#/artist-report`), sticky track bar, Exact/Compact number toggle (`lib/numberMode.ts`, `<Num>`; use `<Num>`
or `displayNumber` for any count shown in the UI, `fullNumber` only for copy/CSV text), last-lookup memory and page titles
(`lib/title.ts`). Details: [Track lookup](../docs/TRACK-LOOKUP.md).

## Integration contracts

- `app/useUrlState.ts`: dataset, inclusive `from`/`to` UTC days, daily/weekly/monthly grain,
  and page parameters are in the hash query. State updates create browser history entries.
- `app/App.tsx`: date bounds come from `/api/meta`. Switching datasets clears dates
  and page filters and selects the appropriate streams/followers navigation. Global
  Export CSV uses `/api/export` with the current query parameters. Tax and Original
  dashboards have no export. `#/quality` is canonical; `#/data-quality` remains an alias.
- `components/ui`: shared controls and prop-driven server-side table sorting/pagination.
  Table pages are zero-based; percentages and confidence use fractions, not 0–100.
  The combobox search callback receives an AbortSignal and debounces 180ms.
- `components/charts`: every chart accepts title, description, ariaLabel, actions,
  height and data-testid. Default IDs identify the chart type; callers can override them.
  CSV preserves missing data as blanks. PNG uses bundled `html-to-image`, embeds local
  fonts, and reports clipboard failures. Clipboard access requires a supported browser
  on localhost. No service, CDN, font API or external image is used.
- `TimeSeriesChart`: input dates normalize to UTC calendar days. Unzoned timestamps
  are UTC. Missing intervals are inserted as null; nulls never become zero. `stepDays`
  defaults to 1 (use 7 for weekly input). Seven-day MA needs seven consecutive known
  daily observations. Monthly observations should supply their own MA series and use
  the appropriate gap ranges/cadence when integrated. Event dots are independent
  annotations; a reset with no plotted value can be marked at the baseline.
- `lib/api.ts`: `getJSON<T>(path, params, signal)` and `ApiError`; `useQuery<T>` shares
  reads by stable URL for 60 seconds, deduplicates requests, and supports refetch.
  Shared cache reads can finish after a subscriber leaves; stale results never replace
  a different URL's state. Use `getJSON` for explicitly cancellable one-off requests.
- Quit fetches `/api/session`, then posts `/api/shutdown` with `X-Viewer-Token`. It
  accepts an empty successful shutdown response and only shows stopped after success.

## Offline build audit

Fonts and the existing StreamBase logo images are copied/bundled locally. Font and
React/Scheduler license notices ship in `licenses/bundled.licenses.css` as comments.
Token blocks
in `src/styles/tokens.css` are verbatim from StreamBase. Readable secondary text uses
a stronger mix without modifying the source token values. Recharts axes and legends
also use readable text while series retain semantic colours.

React contains external error-decoder links and inert XML namespace identifiers.
`build/offline.ts` replaces the error-decoder prefix with offline diagnostic text and
emits only allowlisted namespace strings with escaped slashes, preserving the namespace
values required by the DOM. It rejects unknown HTTP(S) literals, rather than encoding
arbitrary endpoints. `verify-dist.mjs` additionally checks literal URLs, relative assets,
bundled fonts and absence of the development gallery. This transform adds no requests.

The parent `.gitignore` excludes `ui/node_modules` and `ui/dist` as requested.

## Explorer API supplements and checks

`app/api_explorer.py` adds read-only helpers, registered additively in `api_service.py`:

- `/api/explorer/playlists`: existing playlist cards plus range gain and distinct
  observed track count. F2 membership and totals stay separate from ISRC analytics.
- `/api/explorer/playlist/{id}`: original detail calculation with unnamed IDs accepted.
- `/api/explorer/overview`: existing series, unnamed scopes, and member-ISRC
  tracks/artists/reset KPIs for playlist scopes. Those KPIs are explicitly labeled
  separately from F2 counters.
- `/api/explorer/tracks`: existing paginated query with unnamed playlist scopes accepted.
- Added CSV views: `explorer_playlists`, `explorer_playlist`, `explorer_overview`,
  `explorer_tracks`, `followers_overview`, `followers_accounts`, and `archive`.

No database writes, builder changes, or Grafana compatibility changes are needed.
`lib/explorer.ts` translates grain names, preserves nulls, labels buckets, derives
daily counter gaps, merges linked/comparison series, and explains raw reading modes.
MA7 comes directly from the API (four known daily values in seven UTC dates), rather
than the gallery's stricter synthetic seven-value rule. Monthly cadence is not padded
with invented daily observations. Quality coverage/confidence/disagreement summaries
are archive-wide as returned by `/api/quality`; reset rows use the selected range.

Run `$env:LEGACY_API_PORT='PORT'; node scripts/check-explorer.mjs` against the local
API for both stream datasets, every detail contract, grains, raw readings, unnamed
playlists, all CSV views, and the two-second query budget. This check is read-only.
`build/offline.test.ts` verifies the diagnostic-link rewrites and continued rejection
of arbitrary external URLs. Bundled Redux/Toolkit/Immer decoder links are removed;
bare protocol comparisons and inert XML namespaces retain their runtime values.
