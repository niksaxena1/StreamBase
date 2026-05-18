# Agent guide for SpotiBase

## Read this first

SpotiBase has two analytics universes:

1. **Own catalog** in the `public` schema.
2. **Competitors** in the isolated `competitor` schema.

Do not blur them. Competitor work should be additive and schema-scoped; own-catalog workflows, queries, and pages must keep their existing performance characteristics unless the user explicitly asks otherwise.

## Core invariants

- `tracks.isrc` is the stable track identity.
- Competitor data never belongs in `public.*` analytics tables.
- Own-catalog and competitor GitHub Actions are intentionally separate.
- `dataset_mode` + `competitor_label_key` in `public.user_settings` select the current app universe.
- In Competitor Mode, labels may own multiple playlists.
- First-day competitor datasets are valid but thin: totals are meaningful; daily/trend views need at least two snapshots.

## Competitor system map

- Config: `config/competitor_playlists.csv`
- DB foundation: `migrations/add_competitor_foundation.sql`
- Analytics RPCs: `migrations/add_competitor_analytics_rpcs.sql`, `migrations/add_competitor_label_scoped_analytics.sql`
- UI:
  - Home: `web/src/lib/home/loadHomeDashboard.ts`, `web/src/app/(main-flat)/HomeDashboardClient.tsx`
  - Playlists: `web/src/app/(main-flat)/playlists/page.tsx`
  - Catalog: `web/src/app/(main-flat)/catalog/page.tsx`
  - Ops: `web/src/app/(main-flat)/competitors/page.tsx`
  - Global selector: `web/src/components/shell/CompetitorLabelSelector.tsx`
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
- `config/competitor_playlists.csv` and `competitor.playlists` should remain aligned.
- Daily competitor track deltas are expected to be blank until a second snapshot exists.

## Common commands

```powershell
cd web
npm run dev
npx eslint "src/app/(main-flat)/competitors/page.tsx"
```

If touching Supabase SQL, update the corresponding docs and leave migration filenames descriptive enough that future agents can reconstruct the rollout order.
