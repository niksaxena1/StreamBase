-- Migration: Index playlist_memberships by ISRC for /catalog lookups
--
-- /catalog now shows playlist memberships for a selected track (ISRC),
-- which requires querying playlist_memberships by isrc across all playlists.
-- The existing index (playlist_key, isrc, valid_from DESC) is great for playlist pages,
-- but not optimal for track-centric lookups.
--
-- This index supports:
-- - WHERE isrc = ?
-- - ORDER BY playlist_key, valid_from DESC (so we can take latest per playlist quickly)

CREATE INDEX IF NOT EXISTS playlist_memberships_isrc_playlist_validfrom_desc_idx
ON public.playlist_memberships (isrc, playlist_key, valid_from DESC);

