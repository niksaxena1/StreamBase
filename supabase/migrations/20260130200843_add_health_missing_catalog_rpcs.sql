-- Migration: Speed up /health missing-catalog calculations
-- Run this in your Supabase SQL editor.

-- Indexes helpful for time-travel membership queries
CREATE INDEX IF NOT EXISTS playlist_memberships_key_validfrom_idx
ON public.playlist_memberships (playlist_key, valid_from);

CREATE INDEX IF NOT EXISTS playlist_memberships_key_validto_idx
ON public.playlist_memberships (playlist_key, valid_to);

-- Snapshot lookups (date + isrc)
CREATE INDEX IF NOT EXISTS track_daily_streams_date_isrc_idx
ON public.track_daily_streams (date DESC, isrc);

-- Returns missing catalog tracks for a single playlist on a run_date.
-- Exclusions are applied using health_warning_exclusions with code='non_catalog_tracks_present'
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
  excluded AS (
    SELECT e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
      AND (e.playlist_key IS NULL OR e.playlist_key = $1)
  ),
  missing AS (
    SELECT am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded ex ON ex.isrc = am.isrc
    WHERE c.isrc IS NULL
      AND ex.isrc IS NULL
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

-- Returns ALL missing catalog tracks across all playlists on a run_date,
-- grouped by ISRC with playlist_keys aggregated.
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
  excluded AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
  ),
  missing AS (
    SELECT am.playlist_key, am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded ex_global ON ex_global.isrc = am.isrc AND ex_global.playlist_key IS NULL
    LEFT JOIN excluded ex_pl ON ex_pl.isrc = am.isrc AND ex_pl.playlist_key = am.playlist_key
    WHERE c.isrc IS NULL
      AND ex_global.isrc IS NULL
      AND ex_pl.isrc IS NULL
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

