# Competitor Mode Operations

## Current scope

| Competitor | Playlist key | Spotify playlist | SpotOnTrack playlist | Dashboard |
|---|---|---|---:|---:|
| Para?so | `paraiso_releases` | `2RGHAxvb8iosGgP6pd7GFK` | `8948445` | `8609` |
| Soave | `soave_releases` | `6DxYxhfXDnLeaNWHJvHPTu` | `3671138` | `8628` |
| Soave | `soave_dusk_records_releases` | `5AQjRSZARLXzymYlDsDwW0` | `7405352` | `8950` |
| Soave | `soave_radio_releases` | `0WZOHZmfxXX5kTELccugyc` | `5156334` | `8951` |
| Soave | `soave_lofi_releases` | `3j0rbud0hqVC9ZnoV8SPWv` | `7726542` | `8952` |
| Soave | `soave_day_night_records_releases` | `0JkD59thdDkaXd9gaXZSqc` | `10712039` | `8953` |
| Soave | `soave_blaaktrax_releases` | `0kADH0u3ejdnaUpRg57q2K` | `17632814` | `8954` |
| ChillYourMind | `chillyourmind_releases` | `3qExK19cdWKJ5RmCTKzwiy` | `8887309` | `8629` |
| selected. | `selected_releases` | `6QgHdyoJ49khJQ7ZKpEHOi` | `203886` | `8955` |
| ATLAST | `atlast_all_releases` | `4Oeev4VKRe0vknDwwmzc7a` | `51750` | `8957` |
| ATLAST | `atlast_miami_beats_all_releases` | `6Up2rsR545N0TZqCm8jrg9` | `456886` | `8958` |

## Isolation rule

Competitor data lives in the `competitor` schema. It must never be written into the own-catalog `public` tables.

## Daily workflows

- `SOT Competitor Daily Playlist Refresh`
- `SOT Competitor Daily Dashboard Sync`
- `SOT Competitor Daily Export`
- `Spotify competitor enrichment`

The three SpotOnTrack workflows use `config/competitor_playlists.csv`. The Spotify competitor enrichment workflow also refreshes missing `competitor.playlists.spotify_playlist_image_url` values before track enrichment.

## First-run checklist

1. Run the competitor playlist refresh workflow.
2. Run the competitor dashboard sync workflow to populate the SpotOnTrack dashboard.
3. Run the competitor export workflow.
4. Run the Spotify competitor enrichment workflow to fill track metadata and playlist thumbnails.
5. Run `cd web && npm run extract-competitor-accents -- --force` if adding a new label or changing playlist artwork.
6. Switch Settings ? Dataset ? Competitor Mode.
7. Verify the competitor appears under `/competitors`, Playlists, Catalog, Home, and Search.

## UI surfaces

- `/` ? selected competitor overview
- `/playlists` ? competitor playlists, totals, current tracks, and daily deltas when history exists
- `/catalog` ? competitor artists/tracks
- `/competitors` ? operations cockpit for playlist counts, distinct artists, export rows, missing totals, warnings, and day-over-day label deltas

## Adding another competitor

1. Add the label + playlist rows in a migration.
2. Add the playlist to `config/competitor_playlists.csv`.
3. Run refresh ? dashboard sync ? export ? Spotify enrichment.
4. Run `cd web && npm run extract-competitor-accents -- --force` for new labels.
5. Verify `/competitors` and the global competitor selector.

## What the `/competitors` page is for

Competitive intelligence cockpit. Use it to answer:

- Who is growing daily streams fastest? (label comparison chart and table)
- Which tracks moved most today across all competitors? (top movers)
- Which competitor is expanding their catalog fastest? (catalog churn)
- How similar are competitor catalogs? (overlap matrix)

For ingestion correctness (stale playlists, row mismatches, warnings, missing totals), use **/health** (Competitor Health).

## Intentional omissions

Competitor Mode does not currently include collectors or distributor/entity health logic. Those concepts are specific to the own-catalog universe and should not be half-reused.

Weekend dips, negative-stream diagnostics, and spike detection are also intentionally withheld until competitor history is deep enough for them to be meaningful.
