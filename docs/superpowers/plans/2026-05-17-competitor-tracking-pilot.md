# Competitor Tracking Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Paraíso competitor-tracking slice with isolated competitor storage, separate workflows, and an initial app-level Competitor Mode that can read competitor playlist, artist, track, and search data without touching the own-catalog universe.

**Architecture:** Add a parallel `competitor` schema in the existing Supabase project, mirror only the competitor concepts we need, and expose competitor-specific RPCs that match the current app’s analytical vocabulary. Add a mode setting plus a small dataset adapter layer so selected UI routes can switch universes cleanly instead of interleaving schema conditionals throughout the app.

**Tech Stack:** PostgreSQL/Supabase SQL migrations, Python ingestion scripts, GitHub Actions YAML, Next.js 16 App Router, TypeScript, Vitest.

---

## File map

### New files

- `migrations/add_competitor_foundation.sql` — creates the competitor schema, tables, helper functions, RLS posture, and seed rows for Paraíso.
- `migrations/add_competitor_analytics_rpcs.sql` — competitor equivalents for the minimum playlist/artist/track/search read APIs needed by v1.
- `migrations/add_user_settings_dataset_mode.sql` — persists `own | competitor` per user.
- `config/competitor_playlists.csv` — Paraíso pilot config.
- `scripts/ingest_competitor_exports_to_supabase.py` — competitor-only ETL, adapted from the own-catalog ingestion path.
- `.github/workflows/sot_competitor_daily_playlist_refresh.yml` — competitor refresh workflow.
- `.github/workflows/sot_competitor_daily_dashboard_sync.yml` — competitor dashboard sync workflow.
- `.github/workflows/sot_competitor_daily_export.yml` — competitor export + ingest workflow.
- `web/src/lib/datasetMode.ts` — shared mode type/parsing helpers.
- `web/src/lib/datasets/competitor.ts` — competitor-side server query helpers.
- `web/src/lib/datasets/own.ts` — own-catalog adapter helpers for shared interfaces.
- `web/src/lib/datasets/index.ts` — resolves the active adapter.
- `web/src/app/api/user-settings/dataset-mode/route.ts` — get/update mode setting.
- `web/src/app/(main-flat)/settings/DatasetModeSetting.tsx` — Settings UI toggle.
- `web/src/lib/datasets/datasetMode.test.ts` — tests for mode parsing/selection.
- `web/src/lib/datasets/competitor.test.ts` — tests for competitor adapter result shaping.

### Modified files

- `scripts/sot_sync_dashboards.py` — allow competitor config shape / label metadata when needed.
- `scripts/sot_refresh_playlists.py` — reuse with competitor config.
- `scripts/sot_export_dashboards.py` — reuse with competitor config.
- `web/src/app/(main-flat)/settings/page.tsx` — render the new mode setting.
- `web/src/app/(main-flat)/playlists/page.tsx` — branch through dataset adapter for competitor playlist mode.
- `web/src/app/(main-flat)/catalog/page.tsx` — branch through dataset adapter for competitor artist/track mode.
- `web/src/app/api/search/route.ts` — scope search to active dataset.
- `web/src/components/shell/SideRail.tsx` and `web/src/components/shell/MobileNav.tsx` — reflect competitor mode and hide Collectors where it does not apply.
- `web/src/app/(main-flat)/layout.tsx` or shell wrapper files as needed — load active dataset mode and pass it into shell chrome.

## Task 1: Create the competitor database foundation

**Files:**
- Create: `migrations/add_competitor_foundation.sql`
- Create: `migrations/add_user_settings_dataset_mode.sql`

- [ ] **Step 1: Write the failing SQL expectation note**

Create a short verification block at the bottom of `migrations/add_competitor_foundation.sql` as comments describing the expected schema objects and Paraíso seed rows:

```sql
-- Verification checklist after apply:
-- select to_regclass('competitor.labels');
-- select to_regclass('competitor.playlists');
-- select to_regclass('competitor.tracks');
-- select to_regclass('competitor.track_daily_streams');
-- select to_regclass('competitor.playlist_memberships');
-- select to_regclass('competitor.playlist_daily_stats');
-- select label_key, display_name from competitor.labels where label_key = 'paraiso';
-- select playlist_key, label_key from competitor.playlists where playlist_key = 'paraiso_releases';
```

- [ ] **Step 2: Implement the competitor foundation migration**

Add SQL that:

```sql
create schema if not exists competitor;

create table if not exists competitor.labels (
  label_key text primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competitor.playlists (
  playlist_key text primary key,
  label_key text not null references competitor.labels(label_key),
  display_name text not null,
  spotify_playlist_id text,
  spotify_playlist_image_url text,
  sot_playlist_id bigint,
  sot_dashboard_url text not null,
  display_order integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competitor.tracks (
  isrc text primary key,
  name text,
  spotify_track_id text,
  spotify_artist_ids text[],
  spotify_artist_names text[],
  spotify_album_image_url text,
  release_date date,
  first_seen date,
  last_seen date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competitor.track_daily_streams (
  date date not null,
  isrc text not null,
  streams_cumulative bigint,
  est_revenue_total numeric,
  source_run_id bigint,
  primary key (date, isrc)
) partition by range (date);

create table if not exists competitor.playlist_memberships (
  id bigserial primary key,
  playlist_key text not null references competitor.playlists(playlist_key),
  isrc text not null references competitor.tracks(isrc),
  valid_from date not null,
  valid_to date,
  constraint competitor_playlist_memberships_valid_range check (valid_to is null or valid_from <= valid_to)
);

create table if not exists competitor.playlist_daily_stats (
  date date not null,
  playlist_key text not null references competitor.playlists(playlist_key),
  track_count integer,
  total_streams_cumulative bigint,
  daily_streams_net bigint,
  est_revenue_total numeric,
  est_revenue_daily_net numeric,
  missing_streams_track_count integer,
  source_run_id bigint,
  primary key (date, playlist_key)
);

create table if not exists competitor.ingestion_runs (...);
create table if not exists competitor.ingestion_warnings (...);
create table if not exists competitor.raw_exports (...);
```

Include monthly partition helper `competitor.ensure_track_daily_streams_partitions(months_ahead integer default 6)` modeled on the existing public helper, plus indexes for `(isrc, date desc)`, `(date desc, isrc)`, and active membership lookups.

Seed:

```sql
insert into competitor.labels (label_key, display_name)
values ('paraiso', 'Paraíso')
on conflict (label_key) do update set display_name = excluded.display_name;

insert into competitor.playlists (
  playlist_key, label_key, display_name, spotify_playlist_id, sot_playlist_id, sot_dashboard_url, display_order
) values (
  'paraiso_releases', 'paraiso', 'Paraíso Releases', '2RGHAxvb8iosGgP6pd7GFK', 8948445, 'https://www.spotontrack.com/dashboard/8609', 0
)
on conflict (playlist_key) do update set
  label_key = excluded.label_key,
  display_name = excluded.display_name,
  spotify_playlist_id = excluded.spotify_playlist_id,
  sot_playlist_id = excluded.sot_playlist_id,
  sot_dashboard_url = excluded.sot_dashboard_url,
  display_order = excluded.display_order;
```

- [ ] **Step 3: Add the dataset mode migration**

```sql
alter table if exists public.user_settings
  add column if not exists dataset_mode text not null default 'own';

alter table public.user_settings
  drop constraint if exists user_settings_dataset_mode_check;

alter table public.user_settings
  add constraint user_settings_dataset_mode_check
  check (dataset_mode in ('own', 'competitor'));
```

- [ ] **Step 4: Verify SQL syntax locally where possible**

Run:

```powershell
rg -n "create table if not exists competitor|dataset_mode|ensure_track_daily_streams_partitions" migrations\add_competitor_foundation.sql migrations\add_user_settings_dataset_mode.sql
```

Expected: all created objects and setting definitions are present.

- [ ] **Step 5: Commit**

```powershell
git add migrations/add_competitor_foundation.sql migrations/add_user_settings_dataset_mode.sql
git commit -m "Add competitor data foundation"
```

## Task 2: Add competitor analytics RPCs

**Files:**
- Create: `migrations/add_competitor_analytics_rpcs.sql`

- [ ] **Step 1: Define the minimum RPC contract in SQL comments**

```sql
-- v1 competitor read API:
-- competitor.search_all(q, max_results)
-- competitor.playlists_latest_track_counts(p_keys)
-- competitor.playlist_current_tracks(playlist_key, run_date)
-- competitor.playlist_removed_tracks(playlist_key, limit_rows)
-- competitor.playlist_top_tracks_total(playlist_key, run_date, limit_rows)
-- competitor.catalog_artist_series(artist_id, start_date, end_date)
-- competitor.catalog_artist_top_tracks_total(artist_id, run_date, limit_rows)
-- competitor.catalog_artist_top_tracks_daily(artist_id, run_date, limit_rows)
```

- [ ] **Step 2: Implement competitor playlist RPCs**

Mirror the existing public RPC behavior but against `competitor.*` tables. For the pilot, treat `all_competitor` as a virtual union of all active competitor playlists for the selected label only when explicitly added later; for v1, playlist pages may query concrete playlist keys directly.

- [ ] **Step 3: Implement competitor artist RPCs**

Use `competitor.tracks` joined to `competitor.track_daily_streams` to return artist series and top-track summaries with the same output columns used by the current catalog page.

- [ ] **Step 4: Implement competitor search RPC**

Return rows for competitor tracks, artists, and playlists with the same broad shape expected by the search API, but sourced only from `competitor.*`.

- [ ] **Step 5: Verify migration contents**

Run:

```powershell
rg -n "create or replace function competitor\.(search_all|playlists_latest_track_counts|playlist_current_tracks|playlist_removed_tracks|playlist_top_tracks_total|catalog_artist_series|catalog_artist_top_tracks_total|catalog_artist_top_tracks_daily)" migrations\add_competitor_analytics_rpcs.sql
```

Expected: all v1 functions appear once.

- [ ] **Step 6: Commit**

```powershell
git add migrations/add_competitor_analytics_rpcs.sql
git commit -m "Add competitor analytics RPCs"
```

## Task 3: Create competitor config and workflows

**Files:**
- Create: `config/competitor_playlists.csv`
- Create: `.github/workflows/sot_competitor_daily_playlist_refresh.yml`
- Create: `.github/workflows/sot_competitor_daily_dashboard_sync.yml`
- Create: `.github/workflows/sot_competitor_daily_export.yml`

- [ ] **Step 1: Add the pilot config**

```csv
playlist_key,display_name,label_key,is_catalog,playlist_type,dashboard_url,sot_playlist_id,sot_dashboard_name,min_rows
paraiso_releases,Paraíso Releases,paraiso,false,Competitor,https://www.spotontrack.com/dashboard/8609,8948445,Paraíso Releases,1
```

- [ ] **Step 2: Create competitor refresh workflow**

Copy the own-catalog refresh workflow and change:

```yaml
name: SOT Competitor Daily Playlist Refresh
...
python scripts/sot_refresh_playlists.py --config config/competitor_playlists.csv --storage-state sot_state.json $ARGS
```

Use a unique concurrency group such as `sot-competitor-refresh`.

- [ ] **Step 3: Create competitor dashboard sync workflow**

Copy the own-catalog sync workflow and change:

```yaml
name: SOT Competitor Daily Dashboard Sync
...
python scripts/sot_sync_dashboards.py --config config/competitor_playlists.csv --storage-state sot_state.json $ARGS
```

Use competitor artifact names and email subjects.

- [ ] **Step 4: Create competitor export workflow**

Copy the own-catalog export workflow and change:

```yaml
name: SOT Competitor Daily Export
...
python scripts/sot_export_dashboards.py --config config/competitor_playlists.csv --storage-state sot_state.json --headless --fail-on-empty --auth-debug
...
python scripts/ingest_competitor_exports_to_supabase.py --config config/competitor_playlists.csv --exports-dir exports --run-date "$RUN_DATE"
```

Point the dashboard-sync gate at `sot_competitor_daily_dashboard_sync.yml`, use competitor-specific artifact names, and later use competitor ingestion-run checks.

- [ ] **Step 5: Verify YAML and config references**

Run:

```powershell
rg -n "competitor_playlists|SOT Competitor|ingest_competitor_exports_to_supabase" .github\workflows config\competitor_playlists.csv
```

Expected: all competitor workflows reference the competitor config and ETL path only.

- [ ] **Step 6: Commit**

```powershell
git add config/competitor_playlists.csv .github/workflows/sot_competitor_daily_playlist_refresh.yml .github/workflows/sot_competitor_daily_dashboard_sync.yml .github/workflows/sot_competitor_daily_export.yml
git commit -m "Add competitor SpotOnTrack workflows"
```

## Task 4: Build the competitor ingestion script with tests first

**Files:**
- Create: `scripts/ingest_competitor_exports_to_supabase.py`
- Test: `scripts/tests/test_ingest_competitor_exports.py`

- [ ] **Step 1: Write failing parser tests**

```python
def test_load_competitor_playlists_csv_includes_label_key(tmp_path):
    csv_path = tmp_path / "competitor_playlists.csv"
    csv_path.write_text(
        "playlist_key,display_name,label_key,is_catalog,playlist_type,dashboard_url\n"
        "paraiso_releases,Paraíso Releases,paraiso,false,Competitor,https://example.com/dashboard\n",
        encoding="utf-8",
    )

    rows = load_playlists_csv(str(csv_path))

    assert rows[0].playlist_key == "paraiso_releases"
    assert rows[0].label_key == "paraiso"
```

```python
def test_competitor_ingest_targets_competitor_tables():
    assert COMPETITOR_TABLES == {
        "tracks": "competitor.tracks",
        "track_daily_streams": "competitor.track_daily_streams",
        "playlist_memberships": "competitor.playlist_memberships",
        "playlist_daily_stats": "competitor.playlist_daily_stats",
    }
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
python -m pytest scripts/tests/test_ingest_competitor_exports.py -v
```

Expected: FAIL because `ingest_competitor_exports_to_supabase` does not exist yet.

- [ ] **Step 3: Implement the minimum ingestion module**

Start by copying only the reusable parsing/types from `scripts/ingest_exports_to_supabase.py`, then alter the competitor `Playlist` dataclass and write constants so every write target is in the competitor schema.

```python
@dataclass(frozen=True)
class Playlist:
    playlist_key: str
    display_name: str
    label_key: str
    is_catalog: bool
    playlist_type: Optional[str]
    dashboard_url: str
    min_rows: int = 0

COMPETITOR_TABLES = {
    "tracks": "competitor.tracks",
    "track_daily_streams": "competitor.track_daily_streams",
    "playlist_memberships": "competitor.playlist_memberships",
    "playlist_daily_stats": "competitor.playlist_daily_stats",
}
```

Then port the remaining ingestion flow with competitor table names and competitor ingestion-run bookkeeping only.

- [ ] **Step 4: Run tests to verify green**

```powershell
python -m pytest scripts/tests/test_ingest_competitor_exports.py -v
```

Expected: PASS.

- [ ] **Step 5: Add one smoke test for stats row generation**

Write a fixture CSV with two rows and assert the generated playlist total and track count use competitor destinations.

- [ ] **Step 6: Re-run tests and commit**

```powershell
python -m pytest scripts/tests/test_ingest_competitor_exports.py -v
git add scripts/ingest_competitor_exports_to_supabase.py scripts/tests/test_ingest_competitor_exports.py
git commit -m "Add competitor export ingestion"
```

## Task 5: Add dataset mode primitives and settings UI with TDD

**Files:**
- Create: `web/src/lib/datasetMode.ts`
- Create: `web/src/lib/datasets/datasetMode.test.ts`
- Create: `web/src/app/api/user-settings/dataset-mode/route.ts`
- Create: `web/src/app/(main-flat)/settings/DatasetModeSetting.tsx`
- Modify: `web/src/app/(main-flat)/settings/page.tsx`

- [ ] **Step 1: Write failing tests for mode parsing**

```ts
import { describe, expect, it } from "vitest";
import { normalizeDatasetMode } from "@/lib/datasetMode";

describe("normalizeDatasetMode", () => {
  it("returns competitor for competitor", () => {
    expect(normalizeDatasetMode("competitor")).toBe("competitor");
  });

  it("falls back to own for anything else", () => {
    expect(normalizeDatasetMode(undefined)).toBe("own");
    expect(normalizeDatasetMode("garbage")).toBe("own");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
cd web
npm test -- src/lib/datasets/datasetMode.test.ts
```

Expected: FAIL because `normalizeDatasetMode` does not exist.

- [ ] **Step 3: Implement the mode helper**

```ts
export type DatasetMode = "own" | "competitor";

export function normalizeDatasetMode(value: unknown): DatasetMode {
  return value === "competitor" ? "competitor" : "own";
}
```

- [ ] **Step 4: Add the settings API route**

Follow the existing user-settings routes and support:

```ts
GET -> { dataset_mode: "own" | "competitor" }
PATCH body { dataset_mode: "own" | "competitor" }
```

Validate through `normalizeDatasetMode` and persist to `user_settings.dataset_mode`.

- [ ] **Step 5: Add the Settings toggle component**

Render a two-option control with explanatory copy:

```tsx
<DatasetModeSetting initialMode={datasetMode} />
```

The copy should make it explicit that Competitor Mode switches the analytical universe, not merely a page filter.

- [ ] **Step 6: Run tests and commit**

```powershell
cd web
npm test -- src/lib/datasets/datasetMode.test.ts
cd ..
git add web/src/lib/datasetMode.ts web/src/lib/datasets/datasetMode.test.ts web/src/app/api/user-settings/dataset-mode/route.ts 'web/src/app/(main-flat)/settings/DatasetModeSetting.tsx' 'web/src/app/(main-flat)/settings/page.tsx'
git commit -m "Add dataset mode setting"
```

## Task 6: Add dataset adapters and wire search/playlists/catalog

**Files:**
- Create: `web/src/lib/datasets/own.ts`
- Create: `web/src/lib/datasets/competitor.ts`
- Create: `web/src/lib/datasets/index.ts`
- Create: `web/src/lib/datasets/competitor.test.ts`
- Modify: `web/src/app/api/search/route.ts`
- Modify: `web/src/app/(main-flat)/playlists/page.tsx`
- Modify: `web/src/app/(main-flat)/catalog/page.tsx`

- [ ] **Step 1: Write failing adapter tests**

```ts
import { describe, expect, it } from "vitest";
import { datasetSchemaForMode } from "@/lib/datasets";

describe("datasetSchemaForMode", () => {
  it("uses competitor schema in competitor mode", () => {
    expect(datasetSchemaForMode("competitor")).toBe("competitor");
  });

  it("uses public schema in own mode", () => {
    expect(datasetSchemaForMode("own")).toBe("public");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
cd web
npm test -- src/lib/datasets/competitor.test.ts
```

Expected: FAIL because dataset adapters do not exist yet.

- [ ] **Step 3: Implement adapter helpers**

```ts
import type { DatasetMode } from "@/lib/datasetMode";

export function datasetSchemaForMode(mode: DatasetMode) {
  return mode === "competitor" ? "competitor" : "public";
}
```

Add server helpers that wrap the concrete RPC names/tables used by search, playlist page, and catalog page.

- [ ] **Step 4: Scope search by active mode**

In `web/src/app/api/search/route.ts`, load the user’s `dataset_mode` and call `search_all` from the appropriate schema/adapter.

- [ ] **Step 5: Scope playlist and catalog pages by active mode**

For competitor mode:

- query `competitor.playlists` / `competitor.playlist_daily_stats`
- use competitor RPCs for top tracks/current tracks/artist aggregates
- remove own-only assumptions like `all_catalog = releases ? ext`
- preserve current behavior unchanged in own mode

- [ ] **Step 6: Run targeted tests and build**

```powershell
cd web
npm test -- src/lib/datasets/datasetMode.test.ts src/lib/datasets/competitor.test.ts
npm run build
```

Expected: tests pass and Next build succeeds.

- [ ] **Step 7: Commit**

```powershell
git add web/src/lib/datasets web/src/app/api/search/route.ts 'web/src/app/(main-flat)/playlists/page.tsx' 'web/src/app/(main-flat)/catalog/page.tsx'
git commit -m "Wire competitor dataset adapters"
```

## Task 7: Make Competitor Mode visible in the shell

**Files:**
- Modify: `web/src/components/shell/SideRail.tsx`
- Modify: `web/src/components/shell/MobileNav.tsx`
- Modify: `web/src/app/(main-flat)/layout.tsx`

- [ ] **Step 1: Write a failing shell behavior test if there is an existing shell test harness**

If no shell component tests exist, add a small pure helper in `web/src/lib/datasets/index.ts`:

```ts
export function navItemsForMode(mode: DatasetMode, items: Item[]) {
  return mode === "competitor" ? items.filter((item) => item.href !== "/collectors") : items;
}
```

and test:

```ts
it("hides collectors in competitor mode", () => {
  expect(navItemsForMode("competitor", navItems).some((i) => i.href === "/collectors")).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify failure**

```powershell
cd web
npm test -- src/lib/datasets/competitor.test.ts
```

Expected: FAIL until the helper is added.

- [ ] **Step 3: Implement shell mode treatment**

- Load `dataset_mode` in the main layout.
- Pass mode into the shell/nav components.
- Hide Collectors in competitor mode.
- Add explicit visible copy such as `Competitor Mode` and a distinct accent hook/class so the universe switch is unmistakable.

- [ ] **Step 4: Verify and commit**

```powershell
cd web
npm test -- src/lib/datasets/competitor.test.ts
npm run build
cd ..
git add web/src/components/shell/SideRail.tsx web/src/components/shell/MobileNav.tsx 'web/src/app/(main-flat)/layout.tsx' web/src/lib/datasets
git commit -m "Make competitor mode explicit in shell"
```

## Task 8: Pilot verification and operational docs

**Files:**
- Modify: `README.md`
- Modify: `web/src/app/(main-flat)/docs/docs.md`
- Possibly create: `docs/COMPETITOR-MODE-OPERATIONS.md`

- [ ] **Step 1: Document the Paraíso pilot workflow**

Add concise operator notes covering:

- the competitor config file
- the three competitor workflows
- the Paraíso dashboard URLs
- the rule that competitor data lives in the `competitor` schema
- the fact that collectors are intentionally absent in competitor mode

- [ ] **Step 2: Run final verification**

```powershell
python -m pytest scripts/tests/test_ingest_competitor_exports.py -v
cd web
npm test -- src/lib/datasets/datasetMode.test.ts src/lib/datasets/competitor.test.ts
npm run build
cd ..
git status --short
```

Expected: all commands succeed; status only contains intentional changes.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md 'web/src/app/(main-flat)/docs/docs.md' docs/COMPETITOR-MODE-OPERATIONS.md
git commit -m "Document competitor pilot operations"
```

## Self-review

### Spec coverage

- Separate competitor storage plane ? Tasks 1–2
- Paraíso pilot config and workflows ? Task 3
- Competitor-only ingestion ? Task 4
- Settings-backed mode toggle ? Task 5
- Basic Playlists / Catalog / Search support ? Task 6
- Visible global Competitor Mode and hidden Collectors ? Task 7
- Operational docs and verification ? Task 8

### Placeholder scan

- No `TBD`, `TODO`, or unspecified implementation placeholders remain.
- Future-only features from the design spec are explicitly left out of this pilot plan rather than vaguely deferred inside tasks.

### Type consistency

- `DatasetMode` is consistently `"own" | "competitor"`.
- `dataset_mode` is the persisted database column.
- Competitor schema references remain consistently `competitor.*`.
