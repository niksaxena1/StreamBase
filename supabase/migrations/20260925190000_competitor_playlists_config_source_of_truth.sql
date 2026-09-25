-- Make competitor.playlists the source of truth for competitor pipeline config.
--
-- Until now `config/competitor_playlists.csv` held two fields the database did
-- not (SpotOnTrack dashboard name and min_rows), so every new competitor needed
-- a migration *and* a CSV edit. With these columns the /competitors "Add
-- competitor" form can write everything, and the competitor workflows
-- regenerate the CSV from the database at run time
-- (scripts/export_competitor_config_from_db.py).

ALTER TABLE competitor.playlists
  ADD COLUMN IF NOT EXISTS sot_dashboard_name TEXT,
  ADD COLUMN IF NOT EXISTS min_rows INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN competitor.playlists.sot_dashboard_name IS
  'Dashboard name as shown in SpotOnTrack (used by dashboard sync). NULL falls back to display_name.';
COMMENT ON COLUMN competitor.playlists.min_rows IS
  'Export safety: minimum CSV rows expected for this playlist.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitor_playlists_min_rows_nonnegative'
  ) THEN
    ALTER TABLE competitor.playlists
      ADD CONSTRAINT competitor_playlists_min_rows_nonnegative CHECK (min_rows >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitor_labels_accent_hex_format'
  ) THEN
    ALTER TABLE competitor.labels
      ADD CONSTRAINT competitor_labels_accent_hex_format
      CHECK (accent_hex IS NULL OR accent_hex ~ '^[0-9A-Fa-f]{6}$') NOT VALID;
  END IF;
END $$;

-- Backfill from the CSV as of this migration.
UPDATE competitor.playlists p
SET
  sot_dashboard_name = COALESCE(p.sot_dashboard_name, v.sot_dashboard_name),
  min_rows = v.min_rows,
  updated_at = NOW()
FROM (VALUES
  ('paraiso_releases', 'Paraíso Releases', 1),
  ('soave_releases', 'Soave Records Releases', 1),
  ('soave_dusk_records_releases', 'Dusk Records Releases', 1),
  ('soave_radio_releases', 'Soave Radio Releases', 1),
  ('soave_lofi_releases', 'soave lofi releases', 1),
  ('soave_day_night_records_releases', 'Day & Night Records Releases', 1),
  ('soave_blaaktrax_releases', 'Blaaktrax Releases', 1),
  ('soave_evaos_releases', 'ƎVAOS Releases', 1),
  ('chillyourmind_releases', 'ChillYourMind New Official Releases', 1),
  ('selected_releases', 'selected. Releases', 1),
  ('atlast_all_releases', 'ATLAST // All Releases', 1),
  ('atlast_miami_beats_all_releases', 'Miami Beats // All Releases', 1),
  ('musicup_releases', 'MusicUp Releases', 1),
  ('perfect_havoc_records', 'Perfect Havoc Records', 1),
  ('million_hills_releases', 'Million Hills Releases', 1),
  ('lilly_era_releases', 'Lilly Era Releases', 1),
  ('diepgraven_records_all_releases', 'Diepgraven Records 🌴 | All Releases', 1)
) AS v(playlist_key, sot_dashboard_name, min_rows)
WHERE p.playlist_key = v.playlist_key;
