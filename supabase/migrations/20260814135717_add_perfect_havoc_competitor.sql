-- Perfect Havoc competitor label and its records playlist.
-- The playlist is ingested only through the isolated competitor schema.

INSERT INTO competitor.labels (label_key, display_name)
VALUES ('perfect_havoc', 'Perfect Havoc')
ON CONFLICT (label_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = TRUE,
  updated_at = NOW();

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
  'perfect_havoc_records',
  'perfect_havoc',
  'Perfect Havoc Records',
  '5CTdZN6MZc0FOcUL0Olo6g',
  587437,
  'https://www.spotontrack.com/dashboard/11280',
  1
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
