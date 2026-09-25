-- Million Hills competitor label and its releases playlist.
-- The playlist is ingested only through the isolated competitor schema.

INSERT INTO competitor.labels (label_key, display_name)
VALUES ('million_hills', 'Million Hills')
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
  'million_hills_releases',
  'million_hills',
  'Million Hills Releases',
  '1s2T5rJkG0LYiUswJKRY3o',
  17861230,
  'https://www.spotontrack.com/dashboard/11287',
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
