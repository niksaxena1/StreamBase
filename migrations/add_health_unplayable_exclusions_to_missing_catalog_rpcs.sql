-- Migration: Apply unplayable exclusions to missing-catalog health RPCs
-- Run this in your Supabase SQL Editor.

-- Update: health_playlist_missing_catalog_tracks
CREATE OR REPLACE FUNCTION public.health_playlist_missing_catalog_tracks(
  playlist_key TEXT,
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH active_members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  catalog_isrcs AS (
    SELECT s.isrc
    FROM public.track_daily_streams s
    WHERE s.date = $2
  ),
  excluded_nc AS (
    SELECT e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
      AND (e.playlist_key IS NULL OR e.playlist_key = $1)
  ),
  excluded_unplayable AS (
    SELECT e.isrc
    FROM public.health_unplayable_track_exclusions e
    WHERE (e.playlist_key IS NULL OR e.playlist_key = $1)
  ),
  missing AS (
    SELECT am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded_nc ex_nc ON ex_nc.isrc = am.isrc
    LEFT JOIN excluded_unplayable ex_up ON ex_up.isrc = am.isrc
    WHERE c.isrc IS NULL
      AND ex_nc.isrc IS NULL
      AND ex_up.isrc IS NULL
  )
  SELECT
    m.isrc,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM missing m
  LEFT JOIN public.tracks t USING (isrc)
  ORDER BY COALESCE(t.name, m.isrc) ASC;
$$;

GRANT EXECUTE ON FUNCTION public.health_playlist_missing_catalog_tracks(TEXT, DATE) TO anon, authenticated;

-- Update: health_missing_catalog_tracks
CREATE OR REPLACE FUNCTION public.health_missing_catalog_tracks(
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  playlist_keys TEXT[],
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT
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
  catalog_isrcs AS (
    SELECT s.isrc
    FROM public.track_daily_streams s
    WHERE s.date = $1
  ),
  excluded_nc AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
  ),
  excluded_unplayable AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_unplayable_track_exclusions e
  ),
  missing AS (
    SELECT am.playlist_key, am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded_nc ex_global_nc ON ex_global_nc.isrc = am.isrc AND ex_global_nc.playlist_key IS NULL
    LEFT JOIN excluded_nc ex_pl_nc ON ex_pl_nc.isrc = am.isrc AND ex_pl_nc.playlist_key = am.playlist_key
    LEFT JOIN excluded_unplayable ex_global_up ON ex_global_up.isrc = am.isrc AND ex_global_up.playlist_key IS NULL
    LEFT JOIN excluded_unplayable ex_pl_up ON ex_pl_up.isrc = am.isrc AND ex_pl_up.playlist_key = am.playlist_key
    WHERE c.isrc IS NULL
      AND ex_global_nc.isrc IS NULL
      AND ex_pl_nc.isrc IS NULL
      AND ex_global_up.isrc IS NULL
      AND ex_pl_up.isrc IS NULL
  )
  SELECT
    m.isrc,
    array_agg(DISTINCT m.playlist_key ORDER BY m.playlist_key) AS playlist_keys,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM missing m
  LEFT JOIN public.tracks t USING (isrc)
  GROUP BY m.isrc, t.name, t.spotify_artist_names, t.spotify_artist_ids, t.spotify_album_image_url
  ORDER BY COALESCE(t.name, m.isrc) ASC;
$$;

GRANT EXECUTE ON FUNCTION public.health_missing_catalog_tracks(DATE) TO anon, authenticated;

