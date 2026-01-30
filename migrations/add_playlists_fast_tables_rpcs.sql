-- Migration: Speed up /playlists heavy tables (current/added/removed)
-- Run this in your Supabase SQL editor.
--
-- This migration adds:
-- - Indexes for common playlist membership access patterns
-- - Small, stable RPCs that return pre-joined rows for the /playlists page

-- 1) Indexes
-- Current memberships (valid_to is null), ordered by valid_from
CREATE INDEX IF NOT EXISTS playlist_memberships_current_idx
ON public.playlist_memberships (playlist_key, valid_from DESC)
WHERE valid_to IS NULL;

-- Removed memberships (valid_to not null), ordered by valid_to
CREATE INDEX IF NOT EXISTS playlist_memberships_removed_idx
ON public.playlist_memberships (playlist_key, valid_to DESC)
WHERE valid_to IS NOT NULL;

-- Track stream snapshot lookups by date + isrc
CREATE INDEX IF NOT EXISTS track_daily_streams_date_isrc_idx
ON public.track_daily_streams (date DESC, isrc);

-- 2) Helper CTE pattern:
-- We treat `all_catalog` as the union of `releases` and `ext`.
-- For each ISRC:
-- - valid_from = earliest seen across both
-- - valid_to   = NULL if either is current, else latest valid_to

-- 3) Top tracks currently in playlist (sorted by daily delta then total)
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
LANGUAGE sql
STABLE
AS $$
  WITH memberships_union AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1

    UNION ALL
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
  current_members AS (
    SELECT isrc, valid_from
    FROM memberships
    WHERE valid_to IS NULL
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    WHERE $3 IS NOT NULL
      AND s.date = $3
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
  LIMIT GREATEST(COALESCE($4, 200), 0);
$$;

GRANT EXECUTE ON FUNCTION public.playlist_top_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;

-- 4) Tracks added in the last N days (current memberships only)
CREATE OR REPLACE FUNCTION public.playlist_added_tracks(
  playlist_key TEXT,
  run_date DATE,
  days INT DEFAULT 7,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH memberships_union AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1

    UNION ALL
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
  current_added AS (
    SELECT isrc, valid_from
    FROM memberships
    WHERE valid_to IS NULL
      AND valid_from >= ($2 - make_interval(days => GREATEST(COALESCE($3, 7), 0)))::date
  )
  SELECT
    ca.isrc,
    COALESCE(t.name, ca.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    ca.valid_from::date AS valid_from
  FROM current_added ca
  LEFT JOIN public.tracks t USING (isrc)
  ORDER BY ca.valid_from DESC, name ASC
  LIMIT GREATEST(COALESCE($4, 200), 0);
$$;

GRANT EXECUTE ON FUNCTION public.playlist_added_tracks(TEXT, DATE, INT, INT) TO anon, authenticated;

-- 5) Tracks removed (most recent removals first)
CREATE OR REPLACE FUNCTION public.playlist_removed_tracks(
  playlist_key TEXT,
  limit_rows INT DEFAULT 500
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  valid_to DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH memberships_union AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1

    UNION ALL
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
  removed AS (
    SELECT isrc, valid_from, valid_to
    FROM memberships
    WHERE valid_to IS NOT NULL
  )
  SELECT
    r.isrc,
    COALESCE(t.name, r.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    r.valid_from::date AS valid_from,
    r.valid_to::date AS valid_to
  FROM removed r
  LEFT JOIN public.tracks t USING (isrc)
  ORDER BY r.valid_to DESC, name ASC
  LIMIT GREATEST(COALESCE($2, 500), 0);
$$;

GRANT EXECUTE ON FUNCTION public.playlist_removed_tracks(TEXT, INT) TO anon, authenticated;

