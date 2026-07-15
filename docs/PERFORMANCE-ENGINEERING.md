# StreamBase performance engineering

## Enforced budgets

- ESLint: zero errors and no increase above the recorded warning baseline.
- TypeScript, Vitest, production build, and Playwright smoke suite run in `web_quality.yml`.
- JavaScript chunks: 450 KB maximum; page chunks: 250 KB maximum.
- Client components: no file may grow beyond 3,700 lines. Large features must be split by render boundary.

## Measurement

Authenticated browser measurements are sampled at 20%, batched, and written through `/api/performance` to `public.web_performance_metrics`. The table is backend-only. Measurements never include searches, ISRCs, artist/track names, emails, or competitor names.

Tracked signals: route ready, TTFB, LCP, CLS, long tasks, and explicitly marked section readiness. Review p50/p75/p95 by route, dataset mode, browser family, and metric name.

## Cache policy

| Class | Examples | Policy |
|---|---|---|
| Immutable snapshot | daily track/artist/playlist history | Key by dataset, label where applicable, snapshot date, and scope; long TTL |
| Current snapshot | Home, Catalog, Playlists summaries | Short TTL; invalidate after the relevant own or competitor ingestion |
| User configuration | settings, saved filters, access | Request deduplication or private short TTL; never shared across users |

All competitor cache keys must contain the competitor label key. Use `scopedAnalyticsCacheKey` for new shared analytics caches. Own-catalog invalidation must not evict competitor data and vice versa.

Post-ingestion invalidation is implemented by `POST /api/revalidate` (Bearer `REVALIDATE_SECRET`), which revalidates the generic `supabase` tag carried by every `cachedQuery` entry. Both ingestion scripts call it via `scripts/streambase_revalidate.py` when `STREAMBASE_REVALIDATE_URL` and `REVALIDATE_SECRET` are configured as Actions secrets; without them, freshness falls back to TTL expiry.

## Core route query expectations

| Route | Expected server shape | Pagination rule |
|---|---|---|
| Home | aggregate RPCs plus bounded diagnostic samples | Detail panels fetch on demand |
| Catalog | aggregate headers plus paged artists/tracks | Cursor or RPC page; stable final key is ISRC for tracks |
| Playlists | selected-playlist aggregates plus bounded current/movement rows | Large membership tables page server-side |
| Collectors | aggregate comparison and paged drilldowns | Drilldowns must accept page/limit |
| Competitors | label-scoped aggregates only | Never return cross-label raw rows to a selected-label page |
| Health | warning summary plus paged warning details | Warning detail pages remain bounded |
| Network | scoped aggregate graph | Export enrichment is user-triggered and concurrency-bounded |

Every new collection query must have an explicit `.limit`, `.range`, bounded RPC parameter, or a comment explaining why its cardinality is inherently bounded. Record slow RPCs with `timedServerStep`; investigate representative calls with `EXPLAIN (ANALYZE, BUFFERS)` before adding indexes.

## Release review

1. Run `npm run check` and `npm run test:e2e`.
2. Compare bundle budgets and route p95 telemetry.
3. Verify Own Catalog and Competitor Mode independently.
4. Run Supabase Security and Performance Advisors after schema changes.
5. Confirm new public tables include explicit grants and RLS; backend-only tables grant only `service_role`.
