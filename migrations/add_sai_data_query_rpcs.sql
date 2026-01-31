-- Migration: SAI data query RPCs (safe, parameterized templates)
-- Run this in your Supabase SQL editor.
--
-- Purpose:
-- - Provide a small set of whitelisted, bounded, server-enforced data queries
--   for SAI "Data Answers" lane.
--
-- Conventions:
-- - All RPCs are STABLE (read-only).
-- - All RPCs enforce a hard LIMIT for list outputs.
-- - Dates are inclusive.

-- 1) Track total streams on a given snapshot date
CREATE OR REPLACE FUNCTION public.track_total_streams_for_date(
  isrc TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.track_daily_streams s
  WHERE s.isrc = $1
    AND s.date = $2;
$$;

GRANT EXECUTE ON FUNCTION public.track_total_streams_for_date(TEXT, DATE) TO anon, authenticated;

-- 2) Track cumulative series over a date range (one row per day)
CREATE OR REPLACE FUNCTION public.track_series(
  isrc TEXT,
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
  SELECT
    s.date,
    COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
  FROM public.track_daily_streams s
  WHERE s.isrc = $1
    AND s.date >= $2
    AND s.date <= $3
  ORDER BY s.date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.track_series(TEXT, DATE, DATE) TO anon, authenticated;

-- 3) Playlist series (uses playlist_daily_stats which already stores totals/deltas)
CREATE OR REPLACE FUNCTION public.playlist_series(
  playlist_key TEXT,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE (
  date DATE,
  total_streams_cumulative BIGINT,
  daily_streams_net BIGINT,
  track_count INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.date,
    COALESCE(p.total_streams_cumulative, 0)::bigint AS total_streams_cumulative,
    COALESCE(p.daily_streams_net, 0)::bigint AS daily_streams_net,
    COALESCE(p.track_count, 0)::int AS track_count
  FROM public.playlist_daily_stats p
  WHERE p.playlist_key = $1
    AND p.date >= $2
    AND p.date <= $3
  ORDER BY p.date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.playlist_series(TEXT, DATE, DATE) TO anon, authenticated;

-- 4) Playlist top tracks by total streams for a given run_date (bounded)
CREATE OR REPLACE FUNCTION public.playlist_top_tracks_total(
  playlist_key TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_to IS NULL
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS total
    FROM public.track_daily_streams s
    WHERE s.date = $2
  )
  SELECT
    t.isrc,
    COALESCE(tr.name, t.isrc)::text AS name,
    tr.spotify_album_image_url::text AS album_image_url,
    t.total
  FROM members m
  JOIN today t ON t.isrc = m.isrc
  LEFT JOIN public.tracks tr ON tr.isrc = t.isrc
  ORDER BY t.total DESC, name ASC
  LIMIT LEAST(GREATEST(COALESCE($3, 25), 0), 100);
$$;

GRANT EXECUTE ON FUNCTION public.playlist_top_tracks_total(TEXT, DATE, INT) TO anon, authenticated;

