# Competitor Mode Operations

## Pilot scope

- Competitor: Paraíso
- Playlist: `paraiso_releases`
- Spotify playlist: `2RGHAxvb8iosGgP6pd7GFK`
- SpotOnTrack playlist: `8948445`
- SpotOnTrack dashboard: `8609`

## Isolation rule

Competitor data lives in the `competitor` schema. It must never be written into the own-catalog `public` tables.

## Daily workflows

- `SOT Competitor Daily Playlist Refresh`
- `SOT Competitor Daily Dashboard Sync`
- `SOT Competitor Daily Export`

All three workflows use `config/competitor_playlists.csv`.

## First-run checklist

1. Run the competitor playlist refresh workflow.
2. Run the competitor dashboard sync workflow to populate the empty SpotOnTrack dashboard.
3. Run the competitor export workflow.
4. Switch Settings → Dataset → Competitor Mode.
5. Verify Paraíso appears under Playlists, Catalog, and Search.

## Intentional omissions

Competitor Mode does not currently include collectors or distributor/entity health logic. Those concepts are specific to the own-catalog universe and should not be half-reused.
