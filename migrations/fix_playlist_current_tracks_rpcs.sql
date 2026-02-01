-- Migration: Fix "current tracks" playlist RPC semantics
-- Reason:
-- Some environments populate `playlist_memberships.valid_to` with a date even for
-- still-active memberships (instead of NULL). The /playlists "Tracks currently in playlist"
-- table should reflect membership activity *at run_date*:
--   valid_from <= run_date AND (valid_to IS NULL OR valid_to >= run_date)
--
-- This migration updates:
-- - public.playlist_top_tracks
-- - public.playlist_added_tracks
-- - public.playlist_total_streams_for_date (used in some aggregates)

CREATE OR REPLACE FUNCTION public.playlist_total_streams_for_date(
  playlist_key TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.playlist_memberships m
  JOIN public.track_daily_streams_effective_public s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2);
$$;

GRANT EXECUTE ON FUNCTION public.playlist_total_streams_for_date(TEXT, DATE) TO anon, authenticated;


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
  WITH memberships_union_active AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)

    UNION ALL
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE $1 = 'all_catalog'
      AND m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  current_members AS (
    SELECT
      u.isrc,
      -- Current membership start (handles remove/re-add correctly)
      MAX(u.valid_from) AS valid_from
    FROM memberships_union_active u
    GROUP BY u.isrc
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
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
  WITH memberships_union_active AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)

    UNION ALL
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE $1 = 'all_catalog'
      AND m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  current_members AS (
    SELECT
      u.isrc,
      MAX(u.valid_from) AS valid_from
    FROM memberships_union_active u
    GROUP BY u.isrc
  ),
  current_added AS (
    SELECT isrc, valid_from
    FROM current_members
    WHERE valid_from >= ($2 - make_interval(days => GREATEST(COALESCE($3, 7), 0)))::date
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

