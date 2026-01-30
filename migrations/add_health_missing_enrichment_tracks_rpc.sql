-- Migration: Add RPC for /health "tracks_missing_enrichment" details
-- Run this in your Supabase SQL editor.
--
-- Goal: For older warning rows that only store a count (no ISRC list),
-- compute the affected tracks from playlist membership + tracks missing enrichment.

-- Helpful index for membership snapshot lookups
CREATE INDEX IF NOT EXISTS playlist_memberships_key_validfrom_idx
ON public.playlist_memberships (playlist_key, valid_from);

CREATE INDEX IF NOT EXISTS playlist_memberships_key_validto_idx
ON public.playlist_memberships (playlist_key, valid_to);

-- Returns tracks in a playlist on a run_date where spotify enrichment is missing.
-- NOTE: This is used as a fallback when ingestion_warnings.details_json lacks isrc_list.
CREATE OR REPLACE FUNCTION public.health_playlist_missing_enrichment_tracks(
  playlist_key TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 200
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
  WITH memberships_union AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1

    UNION ALL
    -- `all_catalog` is a virtual playlist: union of `releases` + `ext`
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE $1 = 'all_catalog'
      AND m.playlist_key IN ('releases', 'ext')
  ),
  memberships AS (
    SELECT
      u.isrc,
      MIN(u.valid_from) AS valid_from,
      CASE
        WHEN BOOL_OR(u.valid_to IS NULL) THEN NULL
        ELSE MAX(u.valid_to)
      END AS valid_to
    FROM memberships_union u
    GROUP BY u.isrc
  ),
  active_members AS (
    SELECT m.isrc
    FROM memberships m
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  )
  SELECT
    t.isrc,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM active_members am
  JOIN public.tracks t ON t.isrc = am.isrc
  WHERE t.spotify_artist_ids IS NULL
  ORDER BY COALESCE(t.name, t.isrc) ASC
  LIMIT GREATEST(1, LEAST($3, 1000));
$$;

GRANT EXECUTE ON FUNCTION public.health_playlist_missing_enrichment_tracks(TEXT, DATE, INT) TO anon, authenticated;

