-- Migration: Add playlist_type column to playlists table
-- Run this in your Supabase SQL Editor

ALTER TABLE playlists 
ADD COLUMN IF NOT EXISTS playlist_type TEXT;

-- Add a comment to the column
COMMENT ON COLUMN playlists.playlist_type IS 'Classification of playlist: Catalog, Label, Entity, or Distro';
