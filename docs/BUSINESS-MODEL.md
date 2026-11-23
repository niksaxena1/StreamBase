# Business model (read before analysing streams)

Owner-stated, 23 Nov 2026. This is context for agents and analysts; it changes how StreamBase data must be read.

## How the business works

- We sign and release tracks, and also make some tracks ourselves.
- Tracks are marketed through **Spotify playlists**. Those marketing playlists generate the streams.
- The owner decides manually, in Spotify, which tracks go into which marketing playlists and how hard each
  track is pushed. Some tracks are pushed extra hard, some are not.

## What StreamBase playlists are (and are not)

- **StreamBase playlists are bookkeeping, not marketing.** The playlists in `public.playlists` /
  `playlist_memberships` only record which of our entities a track belongs to, which distributor account it
  is in, and similar grouping.
- **Never treat a StreamBase playlist as the thing generating streams.** Do not explain a rise or fall in a
  track's streams by its StreamBase playlist membership, adds or removals.
- StreamBase has **no data on the marketing playlists a track sits in**. That is visible only in Spotify for
  Artists and is not in the database.

## Why streams are tracked

- Distributor reports arrive 3-4 months late. Daily streams are the early estimate of how much money is
  being generated, so the owner is not flying blind.
- So the questions that matter are revenue-shaped: is total daily gain rising or falling, which tracks or
  entities drive it, and is a change real or a data artefact (stale source day, catch-up, dashboard dropout).

## Data we do not have

- Marketing-playlist placements per track (Spotify for Artists only).
- Save rate and other Spotify for Artists engagement metrics. Not exported, on purpose.
- **Do not automate Spotify for Artists** (no scraping, no browser automation, no LLM-driven sessions).
  Spotify may flag bot activity and that would put the whole account and business at risk. Only a manual
  export by the owner, or an official Spotify route, is acceptable.

## How to analyse a stream drop

1. Rule out data artefacts first (flat source day, catch-up, missing rows).
2. Break the change down by track, release age and entity; say how concentrated it is.
3. A track-level drop most likely means a change in marketing-playlist placement or push, which StreamBase
   cannot see. Report the tracks and dates and ask the owner what changed; do not guess a cause from
   StreamBase playlists.
