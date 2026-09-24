# Playlist link health

Own-catalog Health computes `duplicate_spotify_playlist_id` warnings from
`public.playlists` when the active-warning snapshot is refreshed. Each warning
names every configured playlist sharing a non-empty Spotify ID. Competitor
configuration is deliberately outside this check.

Saving a Spotify playlist link in playlist settings recomputes the snapshot and
invalidates Health caches. Ingestion revalidation and the Health refresh action
also recompute it. After deploying this check, refresh Health once to replace any
older persisted snapshot.

These are current-configuration warnings, visible in Active and All; they are
not persisted as historical ingestion events. Once the mapping is corrected,
the warning disappears on refresh.

Spotify IDs control links and Spotify metadata, not the separately configured
SOT dashboards used for ingestion. Correcting a link must not rewrite track
snapshots, memberships, or stream overrides. Refresh the playlist metadata after
changing its ID.
