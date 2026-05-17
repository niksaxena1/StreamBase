# Global Competitor Context + Home Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a globally selected competitor context and make the existing Home page reuse its panels against the selected competitor’s data instead of the own catalog when Competitor Mode is active.

**Architecture:** Extend user settings with a persisted `competitor_label_key`, expose that selection through a global shell control, and teach competitor-aware pages/data loaders to resolve a selected label and its playlist universe. Preserve existing Home components while adding label-scoped competitor data accessors/RPCs where public-schema assumptions currently prevent reuse.

**Tech Stack:** Next.js App Router, React, Supabase/Postgres, TypeScript, SQL, Vitest

---

## File map
- Create migration for `public.user_settings.competitor_label_key`.
- Create migration(s) for competitor label-scoped analytics RPCs needed by Home.
- Modify user-settings API and settings components.
- Add a global competitor selector component in the shell/header.
- Modify Home data loading to branch by dataset mode and selected competitor label while reusing existing panel props.
- Modify competitor Playlists/Catalog/Search scoping to respect the selected competitor label.
- Add tests for settings normalization, selector behavior, and competitor scope helpers.

### Task 1: Persist the selected competitor label

**Files:**
- Create: `migrations/add_user_settings_competitor_label_key.sql`
- Modify: `web/src/app/api/user-settings/all/route.ts`
- Modify: `web/src/app/api/user-settings/dataset-mode/route.ts`
- Add tests under existing dataset/settings test files

- [ ] Add `competitor_label_key TEXT` to `public.user_settings`.
- [ ] Include it in user-settings API payloads.
- [ ] Preserve the value independently from `dataset_mode`.
- [ ] Add tests covering save/load behavior.

### Task 2: Add global competitor selector UX

**Files:**
- Create: shell-level selector component under `web/src/components/shell/`
- Modify: `web/src/app/_shared/AuthedAppLayout.tsx`
- Modify: relevant settings/server loaders

- [ ] Fetch active competitor labels server-side when `dataset_mode = competitor`.
- [ ] Render a compact global selector in the app shell/header.
- [ ] Save changes through a small API route or user-settings patch path.
- [ ] Default gracefully when the saved label is missing.

### Task 3: Add label-scoped competitor analytics primitives

**Files:**
- Create competitor SQL migration(s) for label-scoped Home needs.
- Update typed data access helpers where useful.

- [ ] Add SQL that can resolve the selected label’s active playlist universe.
- [ ] Add label-scoped aggregates for Home panels that cannot reuse own-catalog RPCs directly.
- [ ] Keep all competitor reads in the `competitor` schema.

### Task 4: Make Home scope-switch instead of rebuilding it

**Files:**
- Modify: `web/src/lib/home/loadHomeDashboard.ts`
- Modify: `web/src/app/(main-flat)/page.tsx`
- Add/modify tests for dataset-specific Home loading

- [ ] Read `dataset_mode` and `competitor_label_key`.
- [ ] For own mode, preserve current behavior unchanged.
- [ ] For competitor mode, build the same Home panel props from label-scoped competitor data.
- [ ] Hide only panels whose concepts are not yet valid for competitors.
- [ ] Include dataset/label in cache keys.

### Task 5: Scope other competitor pages to the selected label

**Files:**
- Modify: `web/src/app/(main-flat)/playlists/page.tsx`
- Modify: `web/src/app/(main-flat)/catalog/page.tsx`
- Modify: `web/src/app/api/search/route.ts`

- [ ] Restrict competitor Playlists options to the selected label’s playlists.
- [ ] Restrict Catalog/Search to tracks reachable through the selected label’s playlist memberships.
- [ ] Preserve page-local playlist selection inside that narrower universe.

### Task 6: Verify with Paraíso

**Files:**
- Update docs if needed.

- [ ] Apply migrations.
- [ ] Select Paraíso globally in Competitor Mode.
- [ ] Verify Home shows Paraíso-scoped totals and existing panels where supported.
- [ ] Verify Playlists/Catalog/Search no longer leak own-catalog or other-competitor data.
