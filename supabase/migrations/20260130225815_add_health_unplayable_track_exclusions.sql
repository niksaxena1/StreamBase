-- Migration: Add exclusions for "unplayable/taken-down" tracks
-- Run this in your Supabase SQL Editor.
--
-- Purpose:
-- Some tracks may be taken down/unplayable on Spotify but still present in playlists
-- (e.g., to retain historical stream counts). These should be optionally ignored
-- by missing-catalog health calculations, without being treated as "non-catalog".

CREATE TABLE IF NOT EXISTS public.health_unplayable_track_exclusions (
  id BIGSERIAL PRIMARY KEY,
  playlist_key TEXT NULL,
  isrc TEXT NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.health_unplayable_track_exclusions IS
  'Track-level exclusions for Health missing-catalog calculations (taken-down/unplayable tracks).';

COMMENT ON COLUMN public.health_unplayable_track_exclusions.playlist_key IS
  'Optional scope: NULL applies to all playlists; otherwise applies only to this playlist_key';

COMMENT ON COLUMN public.health_unplayable_track_exclusions.isrc IS
  'Track identity (ISRC or other stable key emitted by exports) to ignore for missing-catalog warnings';

-- Prevent duplicates (treat NULL playlist_key as global).
CREATE UNIQUE INDEX IF NOT EXISTS health_unplayable_track_exclusions_uq
  ON public.health_unplayable_track_exclusions (COALESCE(playlist_key, ''), isrc);

