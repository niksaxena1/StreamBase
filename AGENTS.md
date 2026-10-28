# Agent guide for StreamBase

## Read this first

StreamBase has two analytics universes (plus a small third, Charts, below):

1. **Own catalog** in the `public` schema.
2. **Competitors** in the isolated `competitor` schema.
3. **Charts** (public music-chart snapshots, first: Beatport Tech House Top 100) in the isolated `charts` schema. Separate, additive, independent of the dataset-mode switch; never join it to `public`/`competitor` analytics. See `docs/CHARTS.md`.

Do not blur them. Competitor work should be additive and schema-scoped; own-catalog workflows, queries, and pages must keep their existing performance characteristics unless the user explicitly asks otherwise.

## Core invariants

- `tracks.isrc` is the stable track identity.
- Competitor data never belongs in `public.*` analytics tables.
- Own-catalog and competitor GitHub Actions are intentionally separate.
- `dataset_mode` + `competitor_label_key` in `public.user_settings` select the current app universe.
- In Competitor Mode, labels may own multiple playlists.
- Per-competitor accent color is stored in `competitor.labels.accent_hex` and resolved through `web/src/lib/competitorLabelAccents.ts` (`applyResolvedLabelAccents`) on every label load and in `extract-competitor-accents`. The resolved hex drives `--sb-accent` (chrome) and per-label UI (comparison chart, cards, badges). Stream charts in competitor mode use `getStreamSeriesColor()` → `colors.accent`; revenue/tracks keep semantic colors via `getChartColor()`.
- Competitor history is multi-day; daily/trend views are reliable once ingestion has run across multiple snapshot dates.
- Stream history has three tiers (daily partitions, compact monthly arrays, R2 archive) behind the same views (`*_effective`, `*_effective_public`, `track_daily_streams_all`, `track_daily_streams_range*`). Never read `track_daily_streams` directly for dates older than `stream_history_hot_from()`; never add an unbounded (no lower date bound) read of those views to a page or hot RPC (bound with `stream_compact_from()` in SQL or `recentStreamFloor()` in web). Details: `docs/COMPACT-STREAM-STORAGE.md`.

## Pipeline shared modules

- `scripts/streambase_postgrest.py` — shared PostgREST client (retries with backoff; `schema="competitor"` for competitor tables). Both ingest scripts use it; migrate other scripts' hand-rolled REST calls here when touching them.
- `scripts/streambase_revalidate.py` — best-effort post-ingestion cache refresh via `POST /api/revalidate`.

## Competitor system map

- Config: `competitor.labels` / `competitor.playlists` are the source of truth (admin **Add competitor** on `/competitors`, `web/src/app/api/competitors/onboard/route.ts`). Workflows regenerate `config/competitor_playlists.csv` via `scripts/export_competitor_config_from_db.py`; the committed CSV is a generated snapshot/fallback.
- Atomic service-role-only onboarding RPC: `competitor.onboard_competitor` (label + playlist in one transaction; identical retries return existing records).
- Onboarding config columns/backfill: `supabase/migrations/20261010205727_add_competitor_onboarding_config_columns.sql` (after the foundation and accent migrations).
- DB foundation: `supabase/migrations/20260517014520_add_competitor_foundation.sql`
- Accent colors: `supabase/migrations/20260526152516_add_competitor_label_accent_hex.sql`, `web/src/lib/competitorLabelAccents.ts`, `web/scripts/extract-competitor-accents.ts`
- Analytics RPCs: `supabase/migrations/20260517014521_add_competitor_analytics_rpcs.sql`, `supabase/migrations/20260517191923_add_competitor_label_scoped_analytics.sql`
- UI:
  - Home: `web/src/lib/home/loadHomeDashboard.ts`, `web/src/app/(main-flat)/HomeDashboardClient.tsx`
  - Playlists: `web/src/app/(main-flat)/playlists/page.tsx`
  - Catalog: `web/src/app/(main-flat)/catalog/page.tsx`
  - Ops: `web/src/app/(main-flat)/competitors/page.tsx`
  - Mode switcher: `web/src/components/shell/CompetitorModeButton.tsx`
- Operations docs: `docs/COMPETITOR-MODE-OPERATIONS.md`
- Human product docs: `web/src/app/(main-flat)/docs/docs.md`

## Safe implementation habits

- Prefer service-role reads for private competitor tables after server-side admin gating.
- Keep competitor jobs on their own workflow files and concurrency groups.
- When adding competitor features, ask:
  1. Is this truly competitor-relevant?
  2. Does it need history depth we do not have yet?
  3. Can it be implemented without touching own-catalog hot paths?
- If a page behaves differently by dataset, make the distinction explicit in props or data loading rather than letting public-schema assumptions leak through.

## Useful verification

- Home/Playlists/Catalog in Competitor Mode should use the selected competitor, not raw cross-label URLs.
- `/competitors` should show the same labels/playlists that exist in `competitor.labels` and `competitor.playlists`.
- `config/competitor_playlists.csv` is a snapshot: `python scripts/export_competitor_config_from_db.py --check` reports drift; omit `--check` to refresh it. Exact-count pagination verifies both DB tables. Missing playlists/labels retain committed CSV rows with warnings; only explicitly inactive received playlist rows can remove them. Fewer DB playlists than committed rows or unverifiable counts cause whole-snapshot fallback.
- New labels with blank accents use `applyResolvedLabelAccents` palette fallback at load time. After Spotify enrichment fills thumbnails, run `cd web && npm run extract-competitor-accents` to persist artwork accents; use `--force` only to re-extract existing/custom accents.
- Daily competitor track deltas should be populated; flag any blanks as a regression.

## Common commands

```powershell
cd web
npm run dev
npm run extract-competitor-accents
npx eslint "src/app/(main-flat)/competitors/page.tsx"
```

If touching Supabase SQL, add migrations at `supabase/migrations/<UTC timestamp>_<descriptive_name>.sql` (`YYYYMMDDHHMMSS` in UTC), update the corresponding docs, and ensure unique versions with prerequisites before follow-ups. Apply via Supabase MCP or CLI; see `supabase/README.md` for the workflow. A one-time CLI history baseline is a manual owner decision: reconcile existing MCP records before repairing history; never automatically baseline by date cutoff.

## Supabase Data API Grants

Supabase is changing Data API defaults in 2026:

- May 30, 2026: new Supabase projects no longer expose new `public` tables to the Data API by default.
- October 30, 2026: the same behavior applies to existing projects.

When adding a migration that creates a table in the `public` schema, include explicit grants for the roles that should access it through `supabase-js`, PostgREST, or GraphQL. RLS policies are still required for row/action-level authorization, but RLS alone does not make the table reachable through the Data API.

Use the narrowest grants that match the feature. Prefer `authenticated` for application users, `service_role` for backend-only operations, and only grant `anon` when unauthenticated access is intentionally needed.

Example:

```sql
create table if not exists public.example_table (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.example_table enable row level security;

grant select, insert, update, delete on public.example_table to authenticated;
grant all on public.example_table to service_role;
```

Before broad Supabase schema changes, also check Supabase Security Advisor and review Data API exposure/grants.
