-- Register the TG Symphonic Distro playlist before its first daily ingestion.

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
  'tg_symphonic',
  'TG Symphonic',
  FALSE,
  'Distro',
  'https://www.spotontrack.com/dashboard/12399',
  '2JT6Jn7gPrkvOBqP9Zvb49',
  'TG Sym',
  'https://i.scdn.co/image/ab67616d00001e02b8a54ecdd9b1d7fe935f36f1',
  165,
  'TG',
  'tg_total'
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
