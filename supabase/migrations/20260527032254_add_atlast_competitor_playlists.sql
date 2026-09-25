INSERT INTO competitor.labels (label_key, display_name)
VALUES
  ('atlast', 'ATLAST')
ON CONFLICT (label_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
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
    'atlast_all_releases',
    'atlast',
    'ATLAST // All Releases',
    '4Oeev4VKRe0vknDwwmzc7a',
    51750,
    'https://www.spotontrack.com/dashboard/8957',
    1
  ),
  (
    'atlast_miami_beats_all_releases',
    'atlast',
    'Miami Beats // All Releases',
    '6Up2rsR545N0TZqCm8jrg9',
    456886,
    'https://www.spotontrack.com/dashboard/8958',
    2
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
