# Home section loading and cost estimates

These estimates come from the code, not production timings or requests. Existing
section defaults and localStorage open/closed preferences are preserved.

| Section | Previous loading | Estimated cost and change |
| --- | --- | --- |
| Stream concentration | Scatter on first open; playlist options on mount (specific competitor options arrive with the page) | Warm the shared scatter. Up to 10,000 tracks per label, in 1,000-row RPC pages or competitor snapshots, plus membership enrichment. Concentration sorts tracks locally. Existing options request now shares the dashboard cache with Filters. Selected playlist/collector memberships remain interaction-driven. |
| Tracks: total vs daily | Shared scatter on first open | Uses the same warm response, zero additional HTTP requests. Local track/artist aggregation; artist images remain an optional view request. |
| Tracks per milestone | Shared scatter on first open; milestone settings on mount | Uses the same warm response, zero additional HTTP requests. Local buckets over tracks; existing one-row settings load unchanged. Artist drill-down images remain interaction-driven. |
| Tracks per daily streams | Shared scatter on first open; bucket settings in localStorage | Uses the same warm response, zero additional HTTP requests. Local buckets over tracks; artist drill-down images remain interaction-driven. |
| Filters | Scatter and options/stats/dates on first open | Warm its existing data-loading effects without opening the UI. Own mode: five endpoints (playlist options ≤1,000; playlist stats ≤2,000, with up to three DB reads; catalog dates ≤1,100; track dates ≤100,000 in 1,000-row pages; artists ≤5,000). Playlist options reuse Concentration's request, leaving four new background HTTP requests. Competitor mode: one labels/options endpoint (two competitor-schema reads), plus the shared selected-label scatter; no own-catalog filter endpoints. Selected date scopes still load on demand. |
| Tracks: negative streams | Diagnostics request immediately after mount, regardless of open state | No new prefetch. Shares one HTTP response with weekend dips and artificial spikes; one cached diagnostic/snapshot read or RPC per diagnostic kind. Snapshot fast path limited to 1,000 rows per kind. |
| Artists weekend dip (including track view) | Same mount-time diagnostics response | No new prefetch. Two diagnostic kinds; local filtering and sorting. |
| Artificial stream spikes | Same mount-time diagnostics response | No new prefetch. One diagnostic kind; custom thresholds and individual track-history modals remain interaction-driven. |
| Recent history | Server props already contain history | No request or prefetch change. Main history window is up to range + 7 days; display uses the selected range. |

The idle scheduler starts only after the primary chart component mounts, with a
1.8-second grace period for its initial render/animation. Filter warming follows
250 ms later. Native requestIdleCallback has no forced timeout; the fallback uses
a short timer. Visibility is checked both before queuing and before execution;
hidden-tab work pauses until visibility returns, and cleanup cancels pending work.
Once a request has started, it can finish even if the tab becomes hidden.

A dashboard-lifetime promise cache shares pending and completed requests, scoped
by dataset mode, competitor label, snapshot date, and URL/search parameters. Old
responses cannot update a changed scatter scope; rejected requests leave the cache
so they can be retried. Opening a section before or during warming joins its
existing request. Once warming completes, opening requires no data round trip;
local chart rendering and optional drill-down requests still have their usual cost.

Daily streams range controls opt in only on Home, Playlists and Catalog daily
stream charts. Full range retains the existing domain/interpolation. Typical
range uses the visible points' interpolated 2nd–98th percentiles, includes zero and
the complete visible moving average, then pads 10% (minimum one stream). It plots
clamped values with signed caps while retaining originals in tooltips, clipboard,
CSV and totals. Moving averages can legitimately widen the typical range.
