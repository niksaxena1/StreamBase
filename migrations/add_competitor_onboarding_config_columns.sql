-- Competitor DB config for UI onboarding. Apply after add_competitor_label_accent_hex.sql.
-- Additive, idempotent, competitor-only; no public tables or grants are changed.
BEGIN;

ALTER TABLE competitor.playlists
  ADD COLUMN IF NOT EXISTS sot_dashboard_name TEXT,
  ADD COLUMN IF NOT EXISTS min_rows INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN competitor.playlists.sot_dashboard_name IS
  'SpotOnTrack dashboard name for sync. NULL falls back to display_name.';
COMMENT ON COLUMN competitor.playlists.min_rows IS
  'Export safety: minimum expected CSV rows.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_playlists_min_rows_nonnegative'
      AND conrelid = 'competitor.playlists'::regclass
  ) THEN
    ALTER TABLE competitor.playlists ADD CONSTRAINT competitor_playlists_min_rows_nonnegative
      CHECK (min_rows >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_labels_accent_hex_format'
      AND conrelid = 'competitor.labels'::regclass
  ) THEN
    ALTER TABLE competitor.labels ADD CONSTRAINT competitor_labels_accent_hex_format
      CHECK (accent_hex IS NULL OR accent_hex ~ '^[0-9A-Fa-f]{6}$') NOT VALID;
  END IF;
END $$;

-- Enforce the API's duplicate checks under concurrent submissions too. Inactive
-- rows retain their identities, just as the onboarding lookup checks do.
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_spotify_playlist_id_onboarding_uq
  ON competitor.playlists (spotify_playlist_id) WHERE spotify_playlist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_sot_playlist_id_onboarding_uq
  ON competitor.playlists (sot_playlist_id) WHERE sot_playlist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_sot_dashboard_url_onboarding_uq
  ON competitor.playlists (sot_dashboard_url);

-- Private competitor configuration: access only through admin-gated service-role code.
GRANT USAGE ON SCHEMA competitor TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor.labels, competitor.playlists TO service_role;

-- Generated from current config/competitor_playlists.csv (17 rows).
-- Only unconfigured rows are backfilled: reapplying does not overwrite DB edits.
UPDATE competitor.playlists SET sot_dashboard_name = 'Paraíso Releases', min_rows = 1
WHERE playlist_key = 'paraiso_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Soave Records Releases', min_rows = 1
WHERE playlist_key = 'soave_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Dusk Records Releases', min_rows = 1
WHERE playlist_key = 'soave_dusk_records_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Soave Radio Releases', min_rows = 1
WHERE playlist_key = 'soave_radio_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'soave lofi releases', min_rows = 1
WHERE playlist_key = 'soave_lofi_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Day & Night Records Releases', min_rows = 1
WHERE playlist_key = 'soave_day_night_records_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Blaaktrax Releases', min_rows = 1
WHERE playlist_key = 'soave_blaaktrax_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ƎVAOS Releases', min_rows = 1
WHERE playlist_key = 'soave_evaos_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ChillYourMind New Official Releases', min_rows = 1
WHERE playlist_key = 'chillyourmind_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'selected. Releases', min_rows = 1
WHERE playlist_key = 'selected_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ATLAST // All Releases', min_rows = 1
WHERE playlist_key = 'atlast_all_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Miami Beats // All Releases', min_rows = 1
WHERE playlist_key = 'atlast_miami_beats_all_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'MusicUp Releases', min_rows = 1
WHERE playlist_key = 'musicup_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Perfect Havoc Records', min_rows = 1
WHERE playlist_key = 'perfect_havoc_records' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Million Hills Releases', min_rows = 1
WHERE playlist_key = 'million_hills_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Lilly Era Releases', min_rows = 1
WHERE playlist_key = 'lilly_era_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Diepgraven Records 🌴 | All Releases', min_rows = 1
WHERE playlist_key = 'diepgraven_records_all_releases' AND sot_dashboard_name IS NULL;

COMMIT;
