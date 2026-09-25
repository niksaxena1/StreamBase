INSERT INTO competitor.labels (label_key, display_name)
VALUES
  ('soave', 'Soave'),
  ('chillyourmind', 'ChillYourMind')
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
    'soave_releases',
    'soave',
    'Soave Releases',
    '6DxYxhfXDnLeaNWHJvHPTu',
    3671138,
    'https://www.spotontrack.com/dashboard/8628',
    1
  ),
  (
    'chillyourmind_releases',
    'chillyourmind',
    'ChillYourMind Releases',
    '3qExK19cdWKJ5RmCTKzwiy',
    8887309,
    'https://www.spotontrack.com/dashboard/8629',
    1
  )
ON CONFLICT (playlist_key) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  display_name = EXCLUDED.display_name,
  spotify_playlist_id = EXCLUDED.spotify_playlist_id,
  sot_playlist_id = EXCLUDED.sot_playlist_id,
  sot_dashboard_url = EXCLUDED.sot_dashboard_url,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();
