-- Lilly Era and Diepgraven competitor labels and release playlists.
-- These playlists are ingested only through the isolated competitor schema.

INSERT INTO competitor.labels (label_key, display_name)
VALUES
  ('lilly_era', 'Lilly Era'),
  ('diepgraven', 'Diepgraven')
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
VALUES
  (
    'lilly_era_releases',
    'lilly_era',
    'Lilly Era Releases',
    '5RfLnuLf2eUQbnOhS6GKUn',
    9814064,
    'https://www.spotontrack.com/dashboard/12263',
    1
  ),
  (
    'diepgraven_records_all_releases',
    'diepgraven',
    'Diepgraven Records 🌴 | All Releases',
    '07MzpeD6a32EYRKuxp60o0',
    4704229,
    'https://www.spotontrack.com/dashboard/12262',
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
