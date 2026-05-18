# Competitor Mode Operations

## Current scope

| Competitor | Playlist key | Spotify playlist | SpotOnTrack playlist | Dashboard |
|---|---|---|---:|---:|
| Para?so | `paraiso_releases` | `2RGHAxvb8iosGgP6pd7GFK` | `8948445` | `8609` |
| Soave | `soave_releases` | `6DxYxhfXDnLeaNWHJvHPTu` | `3671138` | `8628` |
| ChillYourMind | `chillyourmind_releases` | `3qExK19cdWKJ5RmCTKzwiy` | `8887309` | `8629` |

## Isolation rule

Competitor data lives in the `competitor` schema. It must never be written into the own-catalog `public` tables.

## Daily workflows

- `SOT Competitor Daily Playlist Refresh`
- `SOT Competitor Daily Dashboard Sync`
- `SOT Competitor Daily Export`
- `Spotify competitor enrichment`

The three SpotOnTrack workflows use `config/competitor_playlists.csv`.

## First-run checklist

1. Run the competitor playlist refresh workflow.
2. Run the competitor dashboard sync workflow to populate the SpotOnTrack dashboard.
3. Run the competitor export workflow.
4. Run the Spotify competitor enrichment workflow.
5. Switch Settings ? Dataset ? Competitor Mode.
6. Verify the competitor appears under `/competitors`, Playlists, Catalog, Home, and Search.

## UI surfaces

- `/` ? selected competitor overview
- `/playlists` ? competitor playlists, totals, current tracks, and daily deltas when history exists
- `/catalog` ? competitor artists/tracks
- `/competitors` ? operations cockpit for playlist counts, export rows, missing totals, warnings, and enrichment gaps

## Adding another competitor

1. Add the label + playlist rows in a migration.
2. Add the playlist to `config/competitor_playlists.csv`.
3. Run refresh ? dashboard sync ? export ? Spotify enrichment.
4. Verify `/competitors` and the global competitor selector.

## What the `/competitors` page is for

Use it to spot:

- labels or playlists missing thumbnails
- raw-export row counts that diverge from ingested track counts
- playlists with missing stream totals
- current active tracks that still lack Spotify enrichment
- playlists accumulating warnings

## Intentional omissions

Competitor Mode does not currently include collectors or distributor/entity health logic. Those concepts are specific to the own-catalog universe and should not be half-reused.

Weekend dips, negative-stream diagnostics, and spike detection are also intentionally withheld until competitor history is deep enough for them to be meaningful.
