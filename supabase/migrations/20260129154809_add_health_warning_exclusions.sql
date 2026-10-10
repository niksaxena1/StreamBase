-- Migration: Add health warning exclusions table
-- Run this in your Supabase SQL Editor

-- Stores track-level exclusions for specific health warning calculations.
-- Currently used to exclude intentional "non-catalog" tracks from missing-catalog warnings.

CREATE TABLE IF NOT EXISTS health_warning_exclusions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  playlist_key TEXT NULL,
  isrc TEXT NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE health_warning_exclusions IS 'Track-level exclusions for Health page warning calculations';
COMMENT ON COLUMN health_warning_exclusions.code IS 'Warning code to apply exclusion to (e.g. non_catalog_tracks_present)';
COMMENT ON COLUMN health_warning_exclusions.playlist_key IS 'Optional scope: NULL applies to all playlists; otherwise applies only to this playlist_key';
COMMENT ON COLUMN health_warning_exclusions.isrc IS 'Track ISRC to exclude from the warning calculation';

-- Prevent duplicate exclusions (treat NULL playlist_key as global).
CREATE UNIQUE INDEX IF NOT EXISTS health_warning_exclusions_uq
  ON health_warning_exclusions (code, COALESCE(playlist_key, ''), isrc);

