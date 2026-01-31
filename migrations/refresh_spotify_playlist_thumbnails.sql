-- One-off data migration: force-refresh Spotify playlist thumbnails
--
-- The UI uses cached fields on `public.playlists`:
-- - spotify_playlist_image_url
-- - spotify_last_fetched_at
--
-- After changing playlist covers on Spotify, clear these caches so the app
-- re-fetches the latest metadata on subsequent page loads.
--
-- Scope: collector playlists only (collector IS NOT NULL) and only rows that
-- have a spotify_playlist_id configured.
--
UPDATE public.playlists
SET
  spotify_playlist_image_url = NULL,
  spotify_last_fetched_at = NULL
WHERE
  spotify_playlist_id IS NOT NULL
  AND collector IS NOT NULL;

