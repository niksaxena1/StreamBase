# API route access classification

Reference for security reviews. Routes use `requireUser`, `requireSessionUser`, or `requireAdmin` from [`web/src/lib/api/server.ts`](../src/lib/api/server.ts), cron secrets, or admin tokens in **headers** (not query strings).

- **`requireUser`**: validates the JWT with Supabase Auth (`getUser()`). Use for sensitive routes (e.g. signed export URLs).
- **`requireSessionUser`**: uses the session from cookies (`getSession()`). Used for same-origin hot paths (search, hover stats, breadcrumbs, Spotify helpers) to avoid extra Auth round-trips; still returns 401 without a session.

Edge gating: [`web/src/proxy.ts`](../src/proxy.ts) (cookie presence) complements route handlers but is not a substitute for server-side checks.

| Access | Route |
|--------|--------|
| **Authenticated (session)** | `/api/health-summary` — banner payload; optional debug via `x-sb-health-debug-token` with `debug=1` |
| **Authenticated (JWT validated)** | `/api/exports` — signed Storage URLs for export downloads |
| **Cron / automation** | `/api/cron/ensure-partitions` — `Authorization: Bearer` + `CRON_SECRET` |
| **Authenticated** | `/api/search`, `/api/search-stats`, `/api/breadcrumb/*`, `/api/spotify-track`, `/api/spotify-track-batch`, `/api/user-settings/*`, `/api/filters/saved`, `/api/sai/chat`, `/api/sai/new`, `/api/sai/models`, `/api/health-history`, `/api/artificial-stream-spikes`, `/api/artificial-stream-spikes/history`, `/api/user-settings/artificial-stream-spike` |
| **Admin** | `/api/admin/*`, `/api/health-actions`, `/api/share/concentration`, `/api/collectors/*`, `/api/dates/catalog-stats`, `/api/playlists/*` (admin routes), `/api/tracks/*` (admin), `/api/reports/*`, `/api/rapidapi-stale-lookup`, `/api/artists/options` |
| **Admin token (header)** | `/api/sai/docs/reindex` — `x-sai-admin-token`; `/api/sai/diagnostics` — `x-sai-admin-token` |

Postgres: analytics RPCs should be executable by the **`authenticated`** role, not **`anon`**, so unauthenticated clients cannot invoke them via PostgREST with the public anon key alone. Apply [`../../migrations/security_hardening_revoke_anon_execute_and_rls.sql`](../../migrations/security_hardening_revoke_anon_execute_and_rls.sql) and follow-up [`../../migrations/security_followup_ops_tables_anon_revoke.sql`](../../migrations/security_followup_ops_tables_anon_revoke.sql) in Supabase after deploying app changes.

For `public.is_admin()`, see [`../../migrations/NOTES_is_admin.md`](../../migrations/NOTES_is_admin.md).
