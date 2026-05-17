# Competitor Spotify Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a competitor-only Spotify enrichment pipeline that fills Spotify metadata in `competitor.tracks` without affecting the existing own-catalog enrichment workflow.

**Architecture:** Create a small competitor-specific enrichment script by adapting the proven own-catalog script to use `Accept-Profile` and `Content-Profile` headers for the `competitor` schema. Add a separate GitHub Actions workflow with its own schedule and concurrency group so operational isolation remains explicit.

**Tech Stack:** Python, requests, Supabase PostgREST, GitHub Actions, unittest

---

## File map
- Create `scripts/enrich_competitor_tracks_with_spotify.py` for competitor-only enrichment logic.
- Create `scripts/tests/test_enrich_competitor_tracks_with_spotify.py` for unit coverage around schema routing and query selection.
- Create `.github/workflows/spotify_competitor_enrich.yml` for the competitor-only scheduled/manual workflow.
- Update `docs/COMPETITOR-MODE-OPERATIONS.md` to document the new daily job.

### Task 1: Add failing tests for competitor enrichment routing

**Files:**
- Create: `scripts/tests/test_enrich_competitor_tracks_with_spotify.py`

- [ ] Write tests asserting competitor PostgREST clients send `Accept-Profile` and `Content-Profile` headers set to `competitor`.
- [ ] Write a test asserting candidate filters prioritize rows with null `spotify_artist_ids` and include the requested limit.
- [ ] Run `python -m unittest scripts.tests.test_enrich_competitor_tracks_with_spotify -v` and confirm it fails because the module does not yet exist.

### Task 2: Implement the competitor enrichment script

**Files:**
- Create: `scripts/enrich_competitor_tracks_with_spotify.py`

- [ ] Adapt the existing Spotify lookup and batch enrichment flow into a competitor-only module.
- [ ] Scope all PostgREST reads/writes to `competitor` via profile headers.
- [ ] Keep batch mode and optional `--isrc` mode.
- [ ] Run the new enrichment unit tests and confirm they pass.
- [ ] Run the existing competitor ingest tests and sync tests to guard against regressions.

### Task 3: Add the separate competitor workflow

**Files:**
- Create: `.github/workflows/spotify_competitor_enrich.yml`

- [ ] Add manual dispatch with configurable `limit`.
- [ ] Add a daily schedule offset from the existing own-catalog enrichment run.
- [ ] Use concurrency group `spotify-competitor-enrich`.
- [ ] Reuse existing Supabase and Spotify secrets.
- [ ] Run the script twice per workflow execution, matching the proven own-catalog pattern.

### Task 4: Document and verify the operational path

**Files:**
- Modify: `docs/COMPETITOR-MODE-OPERATIONS.md`

- [ ] Add the new enrichment workflow to the daily workflow list and first-run checklist.
- [ ] Commit the implementation.
- [ ] Manually trigger the workflow on Paraíso and verify enriched competitor rows exist in `competitor.tracks`.
- [ ] Verify Competitor Mode search/catalog surfaces begin receiving artist metadata after enrichment.
