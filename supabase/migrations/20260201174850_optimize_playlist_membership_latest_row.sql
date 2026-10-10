-- Migration: Optimize playlist RPCs for "valid_to populated" datasets
--
-- Some datasets use `valid_to` as a "next refresh" or far-future date even for
-- still-active memberships. In that case, filtering by:
--   (valid_to IS NULL OR valid_to >= run_date)
-- can still include a large amount of historical membership rows for the same ISRC,
-- especially for large playlists (e.g. `ext`) and cause statement timeouts.
--
-- Fix: take the latest membership row per (playlist_key, isrc) at/before run_date,
-- then decide if it's active at run_date. This is index-friendly with:
--   (playlist_key, isrc, valid_from DESC)
--
-- Applies to:
-- - public.playlist_top_tracks
-- - public.playlist_added_tracks
--
-- Note: 'all_catalog' is treated as union of ('releases','ext') for UI compatibility.

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
  WITH base AS (
    SELECT m.playlist_key, m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE (
      ($1 <> 'all_catalog' AND m.playlist_key = $1)
      OR ($1 = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
    )
      AND m.valid_from <= $2
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
    WHERE l.valid_to IS NULL OR l.valid_to >= $2
  ),
  current_members AS (
    -- If 'all_catalog', an ISRC can be active in either underlying playlist.
    -- For display, use the most recent "added" date among active memberships.
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
      ON o.date = $2 AND o.isrc = cm.isrc
    LEFT JOIN public.track_daily_streams s
      ON s.date = $2 AND s.isrc = cm.isrc
  ),
  prev AS (
    SELECT
      cm.isrc,
      COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
    FROM current_members cm
    LEFT JOIN public.track_daily_stream_overrides o
      ON $3 IS NOT NULL AND o.date = $3 AND o.isrc = cm.isrc
    LEFT JOIN public.track_daily_streams s
      ON $3 IS NOT NULL AND s.date = $3 AND s.isrc = cm.isrc
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
  WITH base AS (
    SELECT m.playlist_key, m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE (
      ($1 <> 'all_catalog' AND m.playlist_key = $1)
      OR ($1 = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
    )
      AND m.valid_from <= $2
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
    WHERE l.valid_to IS NULL OR l.valid_to >= $2
  ),
  current_members AS (
    SELECT a.isrc, MAX(a.valid_from) AS valid_from
    FROM active_per_playlist a
    GROUP BY a.isrc
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

