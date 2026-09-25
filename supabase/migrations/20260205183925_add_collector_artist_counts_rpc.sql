-- Migration: Add collector artist counts RPC (for /collectors comparison table)
-- Run this in your Supabase SQL editor.
--
-- Returns the number of distinct Spotify artist IDs present in the set of tracks
-- that are active (at run_date) in ANY playlist assigned to each collector.
--
-- Usage:
--   select * from public.collector_artist_counts_for_date('2026-01-31');
--
CREATE OR REPLACE FUNCTION public.collector_artist_counts_for_date(
  run_date DATE
)
RETURNS TABLE (
  collector TEXT,
  artist_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH
    collectors AS (
      SELECT DISTINCT upper(trim(p.collector)) AS collector
      FROM public.playlists p
      WHERE p.collector IS NOT NULL
        AND length(trim(p.collector)) > 0
    ),
    collector_playlists AS (
      SELECT upper(trim(p.collector)) AS collector, p.playlist_key
      FROM public.playlists p
      WHERE p.collector IS NOT NULL
        AND length(trim(p.collector)) > 0
    ),
    active_members AS (
      SELECT
        cp.collector,
        m.isrc
      FROM public.playlist_memberships m
      INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
      WHERE m.valid_from <= $1
        AND (m.valid_to IS NULL OR m.valid_to >= $1)
    ),
    per_isrc AS (
      -- De-duplicate tracks per collector before joining tracks/unnesting artists.
      SELECT am.collector, am.isrc
      FROM active_members am
      GROUP BY am.collector, am.isrc
    ),
    artist_ids AS (
      SELECT
        p.collector,
        a.artist_id
      FROM per_isrc p
      INNER JOIN public.tracks t
        ON t.isrc = p.isrc
      CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
      WHERE t.spotify_artist_ids IS NOT NULL
        AND a.artist_id IS NOT NULL
        AND length(a.artist_id) > 0
    ),
    counts AS (
      SELECT collector, COUNT(DISTINCT artist_id)::bigint AS artist_count
      FROM artist_ids
      GROUP BY collector
    )
  SELECT
    c.collector,
    COALESCE(cnt.artist_count, 0)::bigint AS artist_count
  FROM collectors c
  LEFT JOIN counts cnt USING (collector)
  ORDER BY c.collector;
$$;
 
GRANT EXECUTE ON FUNCTION public.collector_artist_counts_for_date(DATE) TO anon, authenticated;

