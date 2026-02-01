-- Migration: Guard playlist_top_tracks against statement_timeout
--
-- If PostgREST (or role settings) enforce a low statement_timeout, large playlists
-- (e.g. releases/ext) can intermittently fail even with indexes.
--
-- This wraps the existing optimized query in PL/pgSQL and increases the local
-- statement_timeout for the duration of the function only.

CREATE OR REPLACE FUNCTION public.playlist_top_tracks(
  playlist_key TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT,
  daily BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- 30s local timeout for this call (admin-only UI).
  PERFORM set_config('statement_timeout', '30000', true);

  RETURN QUERY
  WITH base AS (
    SELECT m.playlist_key, m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE (
      (playlist_key <> 'all_catalog' AND m.playlist_key = playlist_key)
      OR (playlist_key = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
    )
      AND m.valid_from <= run_date
  ),
  latest_per_playlist AS (
    SELECT DISTINCT ON (b.playlist_key, b.isrc)
      b.playlist_key,
      b.isrc,
      b.valid_from,
      b.valid_to
    FROM base b
    ORDER BY b.playlist_key, b.isrc, b.valid_from DESC
  ),
  active_per_playlist AS (
    SELECT l.playlist_key, l.isrc, l.valid_from
    FROM latest_per_playlist l
    WHERE l.valid_to IS NULL OR l.valid_to >= run_date
  ),
  current_members AS (
    SELECT a.isrc, MAX(a.valid_from) AS valid_from
    FROM active_per_playlist a
    GROUP BY a.isrc
  ),
  today AS (
    SELECT
      cm.isrc,
      COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
    FROM current_members cm
    LEFT JOIN public.track_daily_stream_overrides o
      ON o.date = run_date AND o.isrc = cm.isrc
    LEFT JOIN public.track_daily_streams s
      ON s.date = run_date AND s.isrc = cm.isrc
  ),
  prev AS (
    SELECT
      cm.isrc,
      COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
    FROM current_members cm
    LEFT JOIN public.track_daily_stream_overrides o
      ON prev_date IS NOT NULL AND o.date = prev_date AND o.isrc = cm.isrc
    LEFT JOIN public.track_daily_streams s
      ON prev_date IS NOT NULL AND s.date = prev_date AND s.isrc = cm.isrc
  )
  SELECT
    cm.isrc,
    COALESCE(t.name, cm.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    cm.valid_from::date AS valid_from,
    td.streams_cumulative AS total,
    CASE
      WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN NULL
      ELSE GREATEST(0, td.streams_cumulative - pv.streams_cumulative)::bigint
    END AS daily
  FROM current_members cm
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN today td USING (isrc)
  LEFT JOIN prev pv USING (isrc)
  ORDER BY daily DESC NULLS LAST, total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 200), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.playlist_top_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;

