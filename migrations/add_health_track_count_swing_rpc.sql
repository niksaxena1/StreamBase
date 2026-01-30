-- Migration: Speed up /health track_count_swing enrichment
-- Run this in your Supabase SQL editor.
--
-- Provides an RPC to compute added/removed tracks for a playlist between run_date and run_date-1
-- without paginating membership tables in the app.

CREATE OR REPLACE FUNCTION public.health_track_count_swing_tracks(
  playlist_key TEXT,
  run_date DATE
)
RETURNS TABLE (
  change_type TEXT, -- 'added' | 'removed'
  isrc TEXT,
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH
    d AS (
      SELECT $1::text AS playlist_key, $2::date AS run_date, ($2::date - INTERVAL '1 day')::date AS prev_date
    ),
    active_on AS (
      SELECT m.isrc
      FROM public.playlist_memberships m, d
      WHERE m.playlist_key = d.playlist_key
        AND m.valid_from <= d.run_date
        AND (m.valid_to IS NULL OR m.valid_to >= d.run_date)
    ),
    active_prev AS (
      SELECT m.isrc
      FROM public.playlist_memberships m, d
      WHERE m.playlist_key = d.playlist_key
        AND m.valid_from <= d.prev_date
        AND (m.valid_to IS NULL OR m.valid_to >= d.prev_date)
    ),
    added AS (
      SELECT a.isrc
      FROM active_on a
      LEFT JOIN active_prev p ON p.isrc = a.isrc
      WHERE p.isrc IS NULL
    ),
    removed AS (
      SELECT p.isrc
      FROM active_prev p
      LEFT JOIN active_on a ON a.isrc = p.isrc
      WHERE a.isrc IS NULL
    ),
    changed AS (
      SELECT 'added'::text AS change_type, isrc FROM added
      UNION ALL
      SELECT 'removed'::text AS change_type, isrc FROM removed
    )
  SELECT
    c.change_type,
    c.isrc,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM changed c
  LEFT JOIN public.tracks t USING (isrc)
  ORDER BY c.change_type ASC, COALESCE(t.name, c.isrc) ASC;
$$;

GRANT EXECUTE ON FUNCTION public.health_track_count_swing_tracks(TEXT, DATE) TO anon, authenticated;

