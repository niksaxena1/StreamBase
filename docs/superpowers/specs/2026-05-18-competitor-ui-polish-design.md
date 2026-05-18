# Competitor UI polish design

## Goal

Make Competitor Mode feel native rather than bolted on, without expanding the data model beyond what the current rollout needs.

## Chosen approach

Use each competitor's playlist imagery as the primary visual identity for now. The selected competitor can derive its thumbnail from the first active playlist image, which avoids introducing a separate label-logo system before there is a real need for one.

## Changes

1. Fill missing `competitor.playlists.spotify_playlist_image_url` values from Spotify and render them anywhere playlist choices already support thumbnails.
2. Surface the selected competitor's derived thumbnail in the global selector/shell so mode changes are visually obvious.
3. Keep competitor playlist titles display-name driven and verify direct playlist links no longer fall back to raw keys when metadata exists.
4. Make Catalog competitor-aware:
   - keep own-catalog `Distro` behavior unchanged
   - show `ISRC` directly in Competitor Mode instead of a meaningless distro column
5. Add honest "young dataset" messaging on competitor Playlist and Catalog surfaces when there is only one daily snapshot, matching the home page behavior.

## Non-goals

- No separate competitor branding table yet.
- No redesign of the home page or playlist analytics layout.
- No attempt to fabricate trend data when only one snapshot exists.

## Verification

- Paraíso, Soave, and ChillYourMind show playlist thumbnails after refresh.
- Competitor selector shows the active competitor with a thumbnail.
- `/playlists?playlist_key=soave_releases` renders `Soave Releases`, not `soave_releases`.
- Competitor Catalog tables show `ISRC`, while own-catalog behavior remains unchanged.
- One-day messaging appears on competitor Playlist and Catalog pages and disappears naturally once multiple daily snapshots exist.
