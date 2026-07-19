-- Register the Masafy LANDR Distro playlist before its first daily ingestion.
-- The local image path intentionally preserves the supplied LANDR logo even
-- though the Spotify playlist itself no longer has cover artwork.

INSERT INTO public.playlists (
  playlist_key,
  display_name,
  is_catalog,
  playlist_type,
  dashboard_url,
  spotify_playlist_id,
  spotify_playlist_name,
  spotify_playlist_image_url,
  display_order,
  collector,
  entity_playlist_key
)
VALUES (
  'masafy_landr',
  'Masafy LANDR',
  FALSE,
  'Distro',
  'https://www.spotontrack.com/dashboard/10514',
  '4IIofoiQiwf5nfVmISAWWT',
  'Masafy LANDR',
  '/playlist-logos/landr.png',
  230,
  'N',
  NULL
)
ON CONFLICT (playlist_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_catalog = EXCLUDED.is_catalog,
  playlist_type = EXCLUDED.playlist_type,
  dashboard_url = EXCLUDED.dashboard_url,
  spotify_playlist_id = EXCLUDED.spotify_playlist_id,
  spotify_playlist_name = EXCLUDED.spotify_playlist_name,
  spotify_playlist_image_url = EXCLUDED.spotify_playlist_image_url,
  display_order = EXCLUDED.display_order,
  collector = EXCLUDED.collector,
  entity_playlist_key = EXCLUDED.entity_playlist_key;
