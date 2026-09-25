-- Migration: Add search_artists RPC for global search
-- Run this in your Supabase SQL Editor

-- Searches artist names stored on tracks (spotify_artist_ids + spotify_artist_names arrays),
-- across ALL tracks, returning unique artists ordered by track_count.
CREATE OR REPLACE FUNCTION public.search_artists(q TEXT, max_results INT DEFAULT 20)
RETURNS TABLE (
  spotify_artist_id TEXT,
  spotify_artist_name TEXT,
  track_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_rows AS (
    SELECT
      a.artist_id::text  AS spotify_artist_id,
      a.artist_name::text AS spotify_artist_name
    FROM public.tracks t
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
    WHERE a.artist_name IS NOT NULL
      AND lower(a.artist_name) LIKE '%' || lower(q) || '%'
  )
  SELECT
    ar.spotify_artist_id,
    max(ar.spotify_artist_name) AS spotify_artist_name,
    count(*)::bigint AS track_count
  FROM artist_rows ar
  GROUP BY ar.spotify_artist_id
  ORDER BY track_count DESC, spotify_artist_name ASC
  LIMIT greatest(max_results, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_artists(TEXT, INT) TO anon, authenticated;

