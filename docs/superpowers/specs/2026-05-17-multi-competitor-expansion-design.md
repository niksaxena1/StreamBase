# Multi-Competitor Expansion Design

## Goal
Expand Competitor Mode from the Paraíso pilot to three immediately selectable competitors: Paraíso, Soave, and ChillYourMind.

## Architecture
Keep the existing competitor architecture intact: one shared `competitor` schema, one row per competitor label, one or more playlists per label, and the existing separate competitor workflow chain. Soave and ChillYourMind become normal first-class labels, not special cases.

## Data Model
Add two labels:
- `soave` ? `Soave`
- `chillyourmind` ? `ChillYourMind`

Add two playlists:
- `soave_releases` ? Soave Releases / Spotify playlist `6DxYxhfXDnLeaNWHJvHPTu` / SpotOnTrack playlist `3671138` / dashboard `8628`
- `chillyourmind_releases` ? ChillYourMind Releases / Spotify playlist `3qExK19cdWKJ5RmCTKzwiy` / SpotOnTrack playlist `8887309` / dashboard `8629`

## Workflow
Reuse the current competitor workflows unchanged. Append both playlists to `config/competitor_playlists.csv`, then run the same one-time bootstrap path already proven with Paraíso:
1. refresh playlist membership from Spotify / SpotOnTrack
2. sync each SpotOnTrack dashboard until filled
3. export today’s dashboard data
4. ingest into `competitor.*`
5. enrich missing Spotify metadata

## Product Behavior
Both new competitors should appear immediately in the global competitor selector once their labels are seeded. Home, Playlists, Catalog, and Search should scope to whichever label is selected.

## Verification
Confirm:
- both labels and playlists exist in `competitor.labels` / `competitor.playlists`
- config file contains all three playlists
- selector exposes all three competitors
- workflow chain succeeds for both new dashboards
- Home/Playlists/Catalog switch cleanly between Paraíso, Soave, and ChillYourMind
