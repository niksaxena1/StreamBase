-- Migration: Add paged collector artists RPC (for /collectors comparison table drilldown)
-- Run this in your Supabase SQL editor.
--
-- Returns distinct artists (spotify artist id) that appear on tracks which are active
-- (at run_date) in ANY playlist assigned to the given collector.
--
-- Notes:
-- - Artist name is resolved from spotify_artist_images when available, otherwise from tracks array.
-- - track_count is the number of distinct tracks (ISRCs) for the collector that include the artist.
--
-- Usage:
--   select * from public.collector_artists_paged('TG', '2026-02-05', 0, 200);
--
CREATE OR REPLACE FUNCTION public.collector_artists_paged(
  collector TEXT,
  run_date DATE,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  artist_id TEXT,
  name TEXT,
  image_url TEXT,
  track_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH collector_playlists AS (
    SELECT p.playlist_key
    FROM public.playlists p
    WHERE upper(coalesce(p.collector, '')) = upper(coalesce($1, ''))
  ),
  active_members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  per_isrc AS (
    SELECT am.isrc
    FROM active_members am
    GROUP BY am.isrc
  ),
  per_artist AS (
    SELECT
      a.artist_id::text AS artist_id,
      -- Prefer spotify_artist_images.name, otherwise the track-provided name at the same index
      MAX(COALESCE(ai.name, t.spotify_artist_names[a.idx]))::text AS name,
      MAX(ai.image_url)::text AS image_url,
      COUNT(DISTINCT p.isrc)::bigint AS track_count
    FROM per_isrc p
    INNER JOIN public.tracks t
      ON t.isrc = p.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) WITH ORDINALITY AS a(artist_id, idx)
    LEFT JOIN public.spotify_artist_images ai
      ON ai.artist_id = a.artist_id
    WHERE t.spotify_artist_ids IS NOT NULL
      AND a.artist_id IS NOT NULL
      AND length(a.artist_id) > 0
    GROUP BY a.artist_id
  )
  SELECT
    pa.artist_id,
    pa.name,
    pa.image_url,
    pa.track_count
  FROM per_artist pa
  ORDER BY lower(coalesce(pa.name, '')) ASC, pa.artist_id ASC
  OFFSET GREATEST(COALESCE($3, 0), 0)
  LIMIT GREATEST(LEAST(COALESCE($4, 200), 1000), 0);
$$;

GRANT EXECUTE ON FUNCTION public.collector_artists_paged(TEXT, DATE, INT, INT) TO anon, authenticated;

