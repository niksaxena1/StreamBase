# SpotiBase Technical Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a silent 60-second technical demo video that combines real SpotiBase UI footage with accurate backend and schema motion graphics.

**Architecture:** Use Browser-driven captures for live UI, Supabase queries for faithful schema facts, and a dedicated Remotion project for composition, animation, and export. Keep generative media optional and isolated so the real product remains the primary evidence.

**Tech Stack:** Browser plugin, Supabase MCP, Remotion, React/TypeScript, optional Higgsfield CLI, FFmpeg.

---

## File structure
- `video/spotibase-demo/` — dedicated Remotion project for the film.
- `video/spotibase-demo/src/Root.tsx` — composition registration.
- `video/spotibase-demo/src/SpotiBaseDemo.tsx` — top-level timeline orchestration.
- `video/spotibase-demo/src/scenes/*.tsx` — scene-level components split by narrative beat.
- `video/spotibase-demo/src/lib/theme.ts` — shared colors, typography, layout constants.
- `video/spotibase-demo/src/lib/schema.ts` — backend labels and schema facts used by motion graphics.
- `video/spotibase-demo/public/ui/*.png` — captured app screenshots.
- `video/spotibase-demo/public/audio/*.mp3` — optional music bed if used.
- `docs/superpowers/plans/2026-05-18-spotibase-technical-demo-video.md` — this plan.

### Task 1: Capture factual source material
**Files:**
- Create: `video/spotibase-demo/public/ui/*.png`
- Create: `video/spotibase-demo/src/lib/schema.ts`

- [ ] Capture Home, Playlists, Catalog, and Competitors from the live local app at desktop resolution.
- [ ] Query live Supabase metadata for the `public` and `competitor` schemas plus migration names relevant to the current architecture.
- [ ] Encode only the required factual labels into `schema.ts`: major schemas, key tables, and product invariants such as ISRC identity and dataset selection.
- [ ] Review the captures for private/sensitive information and crop or blur only if necessary.

### Task 2: Scaffold the Remotion film
**Files:**
- Create: `video/spotibase-demo/package.json`
- Create: `video/spotibase-demo/src/Root.tsx`
- Create: `video/spotibase-demo/src/SpotiBaseDemo.tsx`
- Create: `video/spotibase-demo/src/lib/theme.ts`

- [ ] Scaffold a blank Remotion project under `video/spotibase-demo/`.
- [ ] Register a `SpotiBaseDemo` composition at 1920x1080, 30fps, 1800 frames.
- [ ] Define shared color, spacing, and type constants that mirror the app palette.
- [ ] Add a minimal opening frame and render a still to verify the project builds.

### Task 3: Build product-film scenes
**Files:**
- Create: `video/spotibase-demo/src/scenes/Opening.tsx`
- Create: `video/spotibase-demo/src/scenes/ProductSurfaces.tsx`

- [ ] Build the 0-08s opening scene using the Home capture and the line `Daily Spotify snapshots -> long-term catalog intelligence`.
- [ ] Build the 08-22s UI montage using real captures from Home, Playlists, Catalog, and Competitors.
- [ ] Add concise overlays: `What is growing?`, `What changed?`, `What needs attention?`.
- [ ] Render representative stills from each scene and adjust readability before proceeding.

### Task 4: Build engineering-explainer scenes
**Files:**
- Create: `video/spotibase-demo/src/scenes/DataFlow.tsx`
- Create: `video/spotibase-demo/src/scenes/SchemaSplit.tsx`
- Create: `video/spotibase-demo/src/scenes/Closing.tsx`

- [ ] Build the 22-38s animated path: `GitHub Actions -> exports -> ingestion/enrichment -> Supabase -> Next.js UI`.
- [ ] Build the 38-50s schema scene showing `public` vs `competitor`, `tracks.isrc`, and `dataset_mode + competitor_label_key` selecting the active universe.
- [ ] Build the 50-60s close with three payoff labels and final lockup `SpotiBase — analytics with memory`.
- [ ] Keep every label truthful to the current repo and live DB.

### Task 5: Add optional generative bridge only if useful
**Files:**
- Optional create: `video/spotibase-demo/public/bridges/*.mp4`

- [ ] Authenticate Higgsfield CLI if credentials are available.
- [ ] Generate at most one abstract bridge clip that visually suggests data flowing into structure.
- [ ] Compare the generated bridge against a pure Remotion transition.
- [ ] Keep the generated asset only if it improves clarity or pacing.

### Task 6: Assemble and finish
**Files:**
- Modify: `video/spotibase-demo/src/SpotiBaseDemo.tsx`
- Optional create: `video/spotibase-demo/public/audio/*.mp3`

- [ ] Sequence all scenes to exactly 60 seconds.
- [ ] Add a subtle music bed only if it strengthens playback without competing with captions.
- [ ] Render a low-resolution draft MP4 and review pacing, legibility, and narrative continuity.
- [ ] Render the final 1080p MP4.

### Task 7: Verify and deliver
**Files:**
- Create: `video/spotibase-demo/README.md`

- [ ] Document how the film was produced, including capture sources and the role of each tool.
- [ ] Verify final duration is 60 seconds, the facts match current production schema, and the video is readable without sound.
- [ ] Share the final MP4 path plus a concise production summary.

## Self-review
- Spec coverage: every design section is represented above, including the silent format, real UI, accurate backend, two-universe schema split, and optional Higgsfield use.
- Placeholder scan: no TODO/TBD placeholders remain.
- Type consistency: file paths and scene names are consistent across tasks.
