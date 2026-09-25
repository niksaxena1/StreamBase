-- Migration: Collector tracks table RPC (for /collectors)
-- Run this in your Supabase SQL editor.
--
-- Returns tracks that are active (on run_date) in ANY playlist belonging to a collector,
-- along with:
-- - cumulative streams on run_date (what's stored in track_daily_streams)
-- - daily delta vs prev_date (can be negative if data corrects)
-- - the playlists the track appears in
-- - which of those playlists are type='Distro'

-- Helpful index: collector -> playlist keys
CREATE INDEX IF NOT EXISTS playlists_collector_idx
ON public.playlists (collector);

CREATE OR REPLACE FUNCTION public.collector_tracks(
  collector TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  limit_rows INT DEFAULT 5000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  playlist_keys TEXT[],
  distro_playlist_keys TEXT[],
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH collector_playlists AS (
    SELECT p.playlist_key, p.playlist_type
    FROM public.playlists p
    WHERE upper(coalesce(p.collector, '')) = upper(coalesce($1, ''))
  ),
  active_members AS (
    SELECT
      m.isrc,
      m.playlist_key
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  per_isrc AS (
    SELECT
      am.isrc,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key) AS playlist_keys,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key)
        FILTER (WHERE cp.playlist_type = 'Distro') AS distro_playlist_keys
    FROM active_members am
    INNER JOIN collector_playlists cp ON cp.playlist_key = am.playlist_key
    GROUP BY am.isrc
  ),
  today AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE $3 IS NOT NULL
      AND s.date = $3
  )
  SELECT
    p.isrc,
    COALESCE(t.name, p.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    COALESCE(p.playlist_keys, ARRAY[]::text[]) AS playlist_keys,
    COALESCE(p.distro_playlist_keys, ARRAY[]::text[]) AS distro_playlist_keys,
    COALESCE(td.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN NULL
      ELSE (td.streams_cumulative - pv.streams_cumulative)::bigint
    END AS daily_streams_delta
  FROM per_isrc p
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN today td USING (isrc)
  LEFT JOIN prev pv USING (isrc)
  ORDER BY daily_streams_delta DESC NULLS LAST, total_streams_cumulative DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($4, 5000), 0);
$$;

GRANT EXECUTE ON FUNCTION public.collector_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;

