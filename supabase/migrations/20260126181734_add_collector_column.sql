-- Migration: Add collector column to playlists table
-- Run this in your Supabase SQL Editor

ALTER TABLE playlists
ADD COLUMN IF NOT EXISTS collector TEXT;

-- Constrain collector to the supported set (or NULL / unassigned)
ALTER TABLE playlists
DROP CONSTRAINT IF EXISTS playlists_collector_check;

ALTER TABLE playlists
ADD CONSTRAINT playlists_collector_check
CHECK (collector IS NULL OR collector IN ('A', 'K', 'N', 'PL', 'TG', 'NL'));

COMMENT ON COLUMN playlists.collector IS 'Collector assignment for playlist aggregation: A, K, N, PL, TG, NL';

