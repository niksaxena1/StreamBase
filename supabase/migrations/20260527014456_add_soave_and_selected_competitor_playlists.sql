INSERT INTO competitor.labels (label_key, display_name)
VALUES
  ('soave', 'Soave'),
  ('selected', 'selected.')
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
    'soave_dusk_records_releases',
    'soave',
    'Dusk Records Releases',
    '5AQjRSZARLXzymYlDsDwW0',
    7405352,
    'https://www.spotontrack.com/dashboard/8950',
    2
  ),
  (
    'soave_radio_releases',
    'soave',
    'Soave Radio Releases',
    '0WZOHZmfxXX5kTELccugyc',
    5156334,
    'https://www.spotontrack.com/dashboard/8951',
    3
  ),
  (
    'soave_lofi_releases',
    'soave',
    'Soave Lofi Releases',
    '3j0rbud0hqVC9ZnoV8SPWv',
    7726542,
    'https://www.spotontrack.com/dashboard/8952',
    4
  ),
  (
    'soave_day_night_records_releases',
    'soave',
    'Day & Night Records Releases',
    '0JkD59thdDkaXd9gaXZSqc',
    10712039,
    'https://www.spotontrack.com/dashboard/8953',
    5
  ),
  (
    'soave_blaaktrax_releases',
    'soave',
    'Blaaktrax Releases',
    '0kADH0u3ejdnaUpRg57q2K',
    17632814,
    'https://www.spotontrack.com/dashboard/8954',
    6
  ),
  (
    'selected_releases',
    'selected',
    'selected. Releases',
    '6QgHdyoJ49khJQ7ZKpEHOi',
    203886,
    'https://www.spotontrack.com/dashboard/8955',
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
