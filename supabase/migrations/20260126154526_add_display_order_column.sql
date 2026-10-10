-- Migration: Add display_order column to playlists table
-- Run this in your Supabase SQL Editor

ALTER TABLE playlists 
ADD COLUMN IF NOT EXISTS display_order INTEGER;

-- Add a comment to the column
COMMENT ON COLUMN playlists.display_order IS 'Display order for playlists (lower numbers appear first)';

-- Set initial display_order based on default grouping
-- All Catalog = 0
-- Releases group = 10-19
-- Others = 20+
UPDATE playlists SET display_order = 0 WHERE playlist_key = 'all_catalog';
UPDATE playlists SET display_order = 10 WHERE playlist_key = 'ext';
UPDATE playlists SET display_order = 11 WHERE playlist_key = 'gahara_records_releases';
UPDATE playlists SET display_order = 12 WHERE playlist_key = 'groove_bassment_releases';
UPDATE playlists SET display_order = 13 WHERE playlist_key = 'final_haus_releases';
UPDATE playlists SET display_order = 20 WHERE playlist_key = 'p_total';
UPDATE playlists SET display_order = 21 WHERE playlist_key = 'tg_total';
UPDATE playlists SET display_order = 22 WHERE playlist_key = 'p_routenote';
UPDATE playlists SET display_order = 23 WHERE playlist_key = 'p_release';
UPDATE playlists SET display_order = 24 WHERE playlist_key = 'tg_amuse';
UPDATE playlists SET display_order = 25 WHERE playlist_key = 'tg_emubands';
UPDATE playlists SET display_order = 26 WHERE playlist_key = 'tg_imusician';
UPDATE playlists SET display_order = 27 WHERE playlist_key = 'tg_toolost';
UPDATE playlists SET display_order = 28 WHERE playlist_key = 'tg_offstep';
UPDATE playlists SET display_order = 29 WHERE playlist_key = 'fh_offstep';
UPDATE playlists SET display_order = 30 WHERE playlist_key = 'gb_routenote';
UPDATE playlists SET display_order = 31 WHERE playlist_key = 'ghr_emubands';
UPDATE playlists SET display_order = 32 WHERE playlist_key = 'tps_emubands';
UPDATE playlists SET display_order = 33 WHERE playlist_key = 'sonomo';
UPDATE playlists SET display_order = 34 WHERE playlist_key = 'masafi_amuse';

-- Set display_order to 100 for any playlists not explicitly set (fallback)
UPDATE playlists SET display_order = 100 WHERE display_order IS NULL;
