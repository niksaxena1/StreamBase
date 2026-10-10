-- Idempotent indexes that speed up network Excel export and artist_collaboration_graph scope.
-- Safe to run if the same names already exist from earlier migrations
-- (add_catalog_artist_aggregate_rpcs, fix_playlist_top_tracks_ambiguous_and_slow, etc.).

CREATE INDEX IF NOT EXISTS track_daily_streams_isrc_date_idx
  ON public.track_daily_streams (isrc, date DESC);

CREATE INDEX IF NOT EXISTS track_daily_streams_date_isrc_idx
  ON public.track_daily_streams (date, isrc);

CREATE INDEX IF NOT EXISTS tracks_spotify_artist_ids_gin_idx
  ON public.tracks
  USING GIN (spotify_artist_ids);

CREATE INDEX IF NOT EXISTS playlist_memberships_playlist_isrc_validfrom_desc_idx
  ON public.playlist_memberships (playlist_key, isrc, valid_from DESC);
