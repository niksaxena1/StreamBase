# Multi-Competitor Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Soave and ChillYourMind as first-class, immediately selectable competitors and fully bootstrap their first day of data through the existing competitor workflow chain.

**Architecture:** Keep the existing shared competitor schema and workflow family. Add two seed rows for labels/playlists, append both playlists to the shared competitor config, then run the already-proven refresh ? dashboard sync ? export/ingest ? enrichment sequence for all competitor data.

**Tech Stack:** Supabase/Postgres, Next.js, Python ingestion scripts, GitHub Actions.

---

### Task 1: Seed competitor metadata
**Files:**
- Create: `migrations/add_soave_and_chillyourmind_competitors.sql`

- [ ] Add idempotent inserts for `competitor.labels` and `competitor.playlists`
- [ ] Verify SQL is rerunnable and uses stable keys
- [ ] Commit

### Task 2: Expand competitor config
**Files:**
- Modify: `config/competitor_playlists.csv`

- [ ] Add Soave and ChillYourMind rows
- [ ] Verify CSV shape matches ingestion expectations
- [ ] Commit

### Task 3: Bootstrap today’s data
**Files:**
- No code changes expected unless workflow defects surface

- [ ] Apply the seed migration to the live SpotiBase database
- [ ] Trigger competitor playlist refresh
- [ ] Trigger competitor dashboard sync
- [ ] Trigger competitor export/ingest
- [ ] Trigger competitor Spotify enrichment
- [ ] Inspect failures, patch defects if found, rerun as needed

### Task 4: Verify app behavior
**Files:**
- Modify only if issues surface during verification

- [ ] Confirm selector exposes Paraíso, Soave, ChillYourMind
- [ ] Confirm each competitor switches Home, Playlists, Catalog, Search scopes correctly
- [ ] Confirm first-day messaging still behaves sensibly for all competitors
- [ ] Commit any corrective changes
