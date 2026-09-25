-- Migration: Catalog artist aggregates (fast /catalog at scale)
-- Run this in your Supabase SQL editor.
--
-- Goal:
-- - Avoid fetching per-track daily rows for an artist on page load.
-- - Compute artist-level time series + top tracks inside Postgres using indexes.
--
-- Notes:
-- - These functions assume:
--   - public.tracks.isrc is join key to public.track_daily_streams.isrc
--   - public.tracks.spotify_artist_ids is a text[] (array)
--   - public.track_daily_streams.date is a date (or coercible)
-- - Functions are marked STABLE (read-only, deterministic for a given snapshot).
--
-- Recommended indexes for keyset-style lookups
CREATE INDEX IF NOT EXISTS track_daily_streams_isrc_date_idx
ON public.track_daily_streams (isrc, date DESC);

-- Speed up "artist contains id" filter on tracks
CREATE INDEX IF NOT EXISTS tracks_spotify_artist_ids_gin_idx
ON public.tracks
USING GIN (spotify_artist_ids);

-- 1) Artist cumulative series (sum of per-track cumulative streams per day)
CREATE OR REPLACE FUNCTION public.catalog_artist_series(
  artist_id TEXT,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE (
  date DATE,
  streams_cumulative BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_isrcs AS (
    SELECT t.isrc
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  )
  SELECT
    s.date,
    SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative
  FROM public.track_daily_streams s
  JOIN artist_isrcs a USING (isrc)
  WHERE s.date >= start_date
    AND s.date <= end_date
  GROUP BY s.date
  ORDER BY s.date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.catalog_artist_series(TEXT, DATE, DATE) TO anon, authenticated;

-- 2) Top tracks by cumulative (for a given run_date)
CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_total(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_tracks AS (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    GREATEST(0, t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$$;

GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_total(TEXT, DATE, INT) TO anon, authenticated;

-- 3) Top tracks by daily delta (for a given run_date)
CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_daily(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_tracks AS (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    GREATEST(0, t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY daily DESC, total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$$;

GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_daily(TEXT, DATE, INT) TO anon, authenticated;

