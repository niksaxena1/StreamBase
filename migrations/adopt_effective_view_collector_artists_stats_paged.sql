-- Migration: Patch collector_artists_stats_paged to use track_daily_streams_effective_public
-- Fixes: manual stream overrides were not reflected in the collector artist drilldown.
--
CREATE OR REPLACE FUNCTION public.collector_artists_stats_paged(
  collector TEXT,
  run_date DATE,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  artist_id TEXT,
  name TEXT,
  image_url TEXT,
  track_count BIGINT,
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
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
  today AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = ($2 - INTERVAL '1 day')::date
  ),
  per_artist AS (
    SELECT
      a.artist_id::text AS artist_id,
      MAX(COALESCE(ai.name, t.spotify_artist_names[a.idx]))::text AS name,
      MAX(ai.image_url)::text AS image_url,
      COUNT(DISTINCT p.isrc)::bigint AS track_count,
      SUM(COALESCE(td.streams_cumulative, 0))::bigint AS total_streams_cumulative,
      SUM(
        CASE
          WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN 0
          ELSE (td.streams_cumulative - pv.streams_cumulative)
        END
      )::bigint AS daily_streams_delta
    FROM per_isrc p
    INNER JOIN public.tracks t
      ON t.isrc = p.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) WITH ORDINALITY AS a(artist_id, idx)
    LEFT JOIN public.spotify_artist_images ai
      ON ai.artist_id = a.artist_id
    LEFT JOIN today td
      ON td.isrc = p.isrc
    LEFT JOIN prev pv
      ON pv.isrc = p.isrc
    WHERE t.spotify_artist_ids IS NOT NULL
      AND a.artist_id IS NOT NULL
      AND length(a.artist_id) > 0
    GROUP BY a.artist_id
  )
  SELECT
    pa.artist_id,
    pa.name,
    pa.image_url,
    pa.track_count,
    pa.total_streams_cumulative,
    pa.daily_streams_delta
  FROM per_artist pa
  ORDER BY pa.daily_streams_delta DESC, pa.total_streams_cumulative DESC, lower(coalesce(pa.name, '')) ASC, pa.artist_id ASC
  OFFSET GREATEST(COALESCE($3, 0), 0)
  LIMIT GREATEST(LEAST(COALESCE($4, 200), 1000), 0);
$$;

GRANT EXECUTE ON FUNCTION public.collector_artists_stats_paged(TEXT, DATE, INT, INT) TO anon, authenticated;
