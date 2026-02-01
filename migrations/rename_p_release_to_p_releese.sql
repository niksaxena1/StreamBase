-- Migration: rename playlist "P Release" -> "P Releese"
-- Run this in your Supabase SQL Editor.
--
-- Notes:
-- - UI reads from playlists.display_name
-- - ingestion upserts playlists.display_name from config/playlists.csv, but this
--   migration updates existing DB rows immediately.

UPDATE playlists
SET display_name = 'P Releese'
WHERE playlist_key = 'p_release'
  AND (display_name IS DISTINCT FROM 'P Releese');

