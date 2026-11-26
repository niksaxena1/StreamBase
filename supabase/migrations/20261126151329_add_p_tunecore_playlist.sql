-- Register the P TuneCore Distro playlist before its first daily ingestion.
-- Entity P (p_total): entity_playlist_key drives the Entity/Distro drift check and
-- playlist_type 'Distro' puts it in the Distro overlap check, like P RouteNote / P Releese.

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
  'p_tunecore',
  'P TuneCore',
  FALSE,
  'Distro',
  'https://www.spotontrack.com/dashboard/14043',
  '7HN9BmWouY4A5WLOJ5fHip',
  'P TC',
  'https://i.scdn.co/image/ab67616d00001e02c5939596100069a8bc07b733',
  95,
  'PL',
  'p_total'
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
