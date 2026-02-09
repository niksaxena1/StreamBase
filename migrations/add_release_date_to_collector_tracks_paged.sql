-- Migration: Add release_date to collector tracks RPC
--
-- The /collectors "Tracks" table needs release date for sorting + display.
-- We extend the existing paged RPC to include `release_date` from `public.tracks`.
--
-- Usage:
--   select * from public.collector_tracks_paged('TG', '2026-01-31', '2026-01-30', 0, 1000);
--
CREATE OR REPLACE FUNCTION public.collector_tracks_paged(
  collector TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 1000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  release_date DATE,
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
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE $3 IS NOT NULL
      AND s.date = $3
  )
  SELECT
    p.isrc,
    COALESCE(t.name, p.isrc)::text AS name,
    t.release_date::date AS release_date,
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
  OFFSET GREATEST(COALESCE($4, 0), 0)
  LIMIT GREATEST(LEAST(COALESCE($5, 1000), 1000), 0);
$$;

-- Re-affirm grants (harmless if already granted).
GRANT EXECUTE ON FUNCTION public.collector_tracks_paged(TEXT, DATE, DATE, INT, INT) TO anon, authenticated;

