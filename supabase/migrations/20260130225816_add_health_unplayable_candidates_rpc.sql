-- Migration: Add RPC to detect likely "unplayable/taken-down" tracks
-- Run this in your Supabase SQL Editor.
--
-- Heuristic:
-- - Track is active in one or more playlists on run_date
-- - Track is missing from the catalog snapshot on run_date (no track_daily_streams row for run_date)
-- - Track HAS appeared in track_daily_streams on some earlier date (< run_date)
--   (i.e., it used to be present in catalog snapshots, but is missing now)
--
-- This is intended to help admins quickly identify tracks to ignore as "unplayable"
-- (separate from intentional "non-catalog" tracks).

CREATE OR REPLACE FUNCTION public.health_unplayable_candidates(
  run_date DATE,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  playlist_keys TEXT[],
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT,
  first_catalog_date DATE,
  last_catalog_date DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH active_members AS (
    SELECT m.playlist_key, m.isrc
    FROM public.playlist_memberships m
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  catalog_today AS (
    SELECT s.isrc
    FROM public.track_daily_streams s
    WHERE s.date = $1
  ),
  excluded_non_catalog AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
  ),
  excluded_unplayable AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_unplayable_track_exclusions e
  ),
  missing_today AS (
    SELECT am.playlist_key, am.isrc
    FROM active_members am
    LEFT JOIN catalog_today ct ON ct.isrc = am.isrc
    LEFT JOIN excluded_non_catalog ex_global_nc
      ON ex_global_nc.isrc = am.isrc AND ex_global_nc.playlist_key IS NULL
    LEFT JOIN excluded_non_catalog ex_pl_nc
      ON ex_pl_nc.isrc = am.isrc AND ex_pl_nc.playlist_key = am.playlist_key
    LEFT JOIN excluded_unplayable ex_global_up
      ON ex_global_up.isrc = am.isrc AND ex_global_up.playlist_key IS NULL
    LEFT JOIN excluded_unplayable ex_pl_up
      ON ex_pl_up.isrc = am.isrc AND ex_pl_up.playlist_key = am.playlist_key
    WHERE ct.isrc IS NULL
      AND ex_global_nc.isrc IS NULL
      AND ex_pl_nc.isrc IS NULL
      AND ex_global_up.isrc IS NULL
      AND ex_pl_up.isrc IS NULL
  ),
  catalog_history AS (
    SELECT s.isrc, MIN(s.date) AS first_catalog_date, MAX(s.date) AS last_catalog_date
    FROM public.track_daily_streams s
    WHERE s.date < $1
    GROUP BY s.isrc
  ),
  candidates AS (
    SELECT m.isrc
    FROM missing_today m
    JOIN catalog_history h ON h.isrc = m.isrc
    GROUP BY m.isrc
  )
  SELECT
    m.isrc,
    array_agg(DISTINCT m.playlist_key ORDER BY m.playlist_key) AS playlist_keys,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url,
    h.first_catalog_date,
    h.last_catalog_date
  FROM missing_today m
  JOIN candidates c ON c.isrc = m.isrc
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN catalog_history h ON h.isrc = m.isrc
  GROUP BY m.isrc, t.name, t.spotify_artist_names, t.spotify_artist_ids, t.spotify_album_image_url, h.first_catalog_date, h.last_catalog_date
  ORDER BY h.last_catalog_date DESC NULLS LAST, COALESCE(t.name, m.isrc) ASC
  LIMIT GREATEST(1, LEAST($2, 2000));
$$;

GRANT EXECUTE ON FUNCTION public.health_unplayable_candidates(DATE, INT) TO anon, authenticated;

