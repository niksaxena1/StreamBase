# Home and Playlists load scheduling

`STREAMBASE_PERF_LOG=1` enables server-only `[perf] <label> <ms> ms` logs for
`getRequestAppContext`, `loadHomeDashboardData`, and `loadPlaylistsPage`. No user
identifiers, tokens, or query parameters are logged. Disabled by default.

## Measurement

Dependencies were installed with `cd web; npm ci`. A development server on port
3100 confirmed that session-less `/` requests redirect (HTTP 307) to login, so
these are **loader harness measurements, not authenticated production timings**.
The harness executes the real loaders with synthetic Supabase responses and an
80 ms delay per network round trip, bypassing `unstable_cache` for cold reads.
Claims verification simulates a warm local ES256 verification. Cold JWKS reads
and token refreshes can still require network access in production.

| Label | Dataset | Before ms | After ms |
| --- | --- | ---: | ---: |
| getRequestAppContext | own | 162.2 | 81.0 |
| getRequestAppContext | competitor | 161.8 | 80.3 |
| loadHomeDashboardData | own | 406.2 | 325.5 |
| loadHomeDashboardData | competitor | 402.3 | 321.0 |
| loadPlaylistsPage | own | 969.1 | 489.1 |
| loadPlaylistsPage | competitor | 569.1 | 401.1 |

Playlists measurements include request context; Home loader measurements exclude
it. Before values were also reproduced from the original HEAD sources using the
same harness and instrumentation. Original and optimized loads matched the
captured props and sorted schema-qualified query signatures in both universes.
These fixtures exercise overrides and own-playlist summary fallback queries;
they do not represent the full production catalog or measure browser hydration.

To capture a baseline before a scheduling change, then compare after it:

```powershell
cd web
$env:STREAMBASE_PERF_LOG = '1'
$env:STREAMBASE_PERF_BASELINE = '1'
npx vitest run src/lib/webLoad.perf.test.ts
Remove-Item Env:STREAMBASE_PERF_BASELINE
# Make the scheduling change, then run the same comparison:
npx vitest run src/lib/webLoad.perf.test.ts
Remove-Item Env:STREAMBASE_PERF_LOG
```

The baseline lives in the OS temporary directory, contains synthetic fixture
data only, and is not committed. Normal `npm test` skips the opt-in timing
comparison but runs the authorization/redirect regressions in this harness.

## Scheduling and cache invariants

Identity uses `getClaims()`; only verified subject/email are consumed. Invalid
identities redirect through the existing gates. Admin/access/settings checks
remain per-request, deduplicated only with React `cache()`. Supabase documents
local signature/expiry verification and the distinction from server-side session
revocation checks: https://supabase.com/docs/guides/auth/server-side/advanced-guide

Home's initial settings, health configuration, override versions, rollback and
image reads were already parallel in the base branch. They stay behind the
request access gate. Specific competitor label details now overlap history;
unset label selection still resolves its key before history queries. Both Home
and Playlists fetch annotation metadata/memberships concurrently after override
ISRCs arrive. Playlists also overlaps settings/version, dashboard summary, and
conditional artist/removed fallbacks. Invalid playlist keys keep their original
query set before redirecting.

Home renders its existing header/controls while the data promise is pending,
with separate Suspense boundaries for header completion, dashboard skeletons,
and the own-only notice. Shared granularity state keeps header controls and
charts synchronized. Playlists uses its existing loading skeleton while its
main loader runs; the existing tracks boundary remains independent. Below-fold
concentration and artificial-stream sections use `next/dynamic` and fixed 42 px
collapsed-section placeholders; SSR remains enabled.

No `staleTimes`, query filters, cache keys/TTLs, accounting logic or schema
migrations change. Own and competitor analytics retain their distinct schemas.

## Verification

`npm run lint` passes (218 warnings, zero errors), `npx tsc --noEmit` passes,
`npm test` passes 439 tests (the timing comparison is opt-in), and the production
build passes. The explicit timing comparison passes all three harness checks.
Production `next start` on port 3100 returns HTTP 307 for session-less Home and
invalid-cookie Home/Playlists requests. The build's loadable manifest confirms
separate chunks for both deferred chart sections. No authenticated browser
session was available for a visual/TTFB check.
