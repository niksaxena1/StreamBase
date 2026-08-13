-- ƎVAOS is a Soave sublabel; keep it scoped to the existing Soave competitor label.

INSERT INTO competitor.playlists (
  playlist_key,
  label_key,
  display_name,
  spotify_playlist_id,
  sot_playlist_id,
  sot_dashboard_url,
  display_order
)
VALUES (
  'soave_evaos_releases',
  'soave',
  'ƎVAOS Releases',
  '6sgBTQYyvMjxRydyuRX7FC',
  17859449,
  'https://www.spotontrack.com/dashboard/11239',
  7
)
ON CONFLICT (playlist_key) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  display_name = EXCLUDED.display_name,
  spotify_playlist_id = EXCLUDED.spotify_playlist_id,
  sot_playlist_id = EXCLUDED.sot_playlist_id,
  sot_dashboard_url = EXCLUDED.sot_dashboard_url,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  updated_at = NOW();
