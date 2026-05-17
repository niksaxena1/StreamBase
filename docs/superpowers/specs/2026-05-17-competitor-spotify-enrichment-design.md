# Competitor Spotify Enrichment Design

## Goal
Add a competitor-only Spotify enrichment path so tracks in `competitor.tracks` gain Spotify IDs, artist IDs/names, album art, and fetch timestamps without touching the existing own-catalog enrichment flow.

## Chosen approach
Use a separate competitor enrichment script and a separate GitHub Actions workflow. Reuse the same Spotify lookup behavior as the existing own-catalog script, but keep PostgREST requests scoped to the `competitor` schema and use a distinct workflow concurrency group.

## Why this shape
- Preserves the data boundary between own catalog and competitor catalog.
- Avoids changing a working own-catalog enrichment workflow.
- Keeps failure domains legible: competitor enrichment can fail without changing or cancelling own-catalog enrichment.
- Daily competitor volume is small enough that a separate job is operationally cheap.

## Behavior
- Select competitor tracks ordered with unenriched rows first, then most recently seen.
- Enrich missing or stale tracks by ISRC through Spotify search.
- Persist: `spotify_track_id`, `spotify_album_image_url`, `spotify_artist_ids`, `spotify_artist_names`, and `spotify_last_fetched_at`.
- Support batch mode plus optional single-ISRC re-enrichment for debugging.
- Run on demand and on a daily schedule offset from the existing own-catalog Spotify enrichment workflow.

## Isolation and safety
- Read/write only the `competitor` schema.
- Use a new workflow concurrency group: `spotify-competitor-enrich`.
- Schedule separately from the existing own-catalog job to reduce shared pressure on Spotify API and GitHub runners.
- Reuse existing Spotify credentials and service-role Supabase credentials; no new secrets are required.

## Testing
- Add unit tests for competitor PostgREST headers/schema routing and candidate selection behavior.
- Verify the script locally with tests.
- Run the competitor enrichment workflow manually for the Paraíso pilot and confirm rows in `competitor.tracks` receive artist metadata.
