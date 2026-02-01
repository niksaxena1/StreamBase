-- Migration: Fix playlist_top_tracks "playlist_key is ambiguous" + speed up large playlists
--
-- Symptom:
-- - UI shows: column reference "playlist_key" is ambiguous
-- - Some playlists (e.g. ext) still hit statement_timeout
--
-- Root causes:
-- 1) PL/pgSQL function parameters named `playlist_key` collide with table columns.
-- 2) Single-query implementations that include an OR branch for 'all_catalog' can
--    prevent optimal index usage for large playlists.
--
-- Fix:
-- - Keep parameter names stable (so CREATE OR REPLACE works in Postgres),
--   but copy them into local v_* variables to avoid ambiguity.
-- - Use PL/pgSQL IF branching so Postgres can plan a fast path for normal playlists.
-- - Keep a generous LOCAL statement_timeout for this admin-only RPC.
-- - Ensure an index exists to support DISTINCT ON by (playlist_key,isrc,valid_from desc).

CREATE INDEX IF NOT EXISTS playlist_memberships_playlist_isrc_validfrom_desc_idx
ON public.playlist_memberships (playlist_key, isrc, valid_from DESC);

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
DECLARE
  v_playlist_key TEXT := playlist_key;
  v_run_date DATE := run_date;
  v_prev_date DATE := prev_date;
  v_limit_rows INT := limit_rows;
BEGIN
  -- Increase timeout for this admin-only analytics call.
  PERFORM set_config('statement_timeout', '120000', true); -- 120s

  IF v_playlist_key = 'all_catalog' THEN
    RETURN QUERY
    WITH latest_per_playlist AS (
      -- Latest membership row per (playlist_key,isrc) at/before run_date
      SELECT DISTINCT ON (m.playlist_key, m.isrc)
        m.playlist_key,
        m.isrc,
        m.valid_from::date AS valid_from,
        m.valid_to::date AS valid_to
      FROM public.playlist_memberships m
      WHERE m.playlist_key IN ('releases', 'ext')
        AND m.valid_from <= v_run_date
      ORDER BY m.playlist_key, m.isrc, m.valid_from DESC
    ),
    active_per_playlist AS (
      SELECT l.playlist_key, l.isrc, l.valid_from
      FROM latest_per_playlist l
      WHERE l.valid_to IS NULL OR l.valid_to >= v_run_date
    ),
    current_members AS (
      -- An ISRC is in all_catalog if it's active in either playlist; show the most recent add date.
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
        ON o.date = v_run_date AND o.isrc = cm.isrc
      LEFT JOIN public.track_daily_streams s
        ON s.date = v_run_date AND s.isrc = cm.isrc
    ),
    prev AS (
      SELECT
        cm.isrc,
        COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
      FROM current_members cm
      LEFT JOIN public.track_daily_stream_overrides o
        ON v_prev_date IS NOT NULL AND o.date = v_prev_date AND o.isrc = cm.isrc
      LEFT JOIN public.track_daily_streams s
        ON v_prev_date IS NOT NULL AND s.date = v_prev_date AND s.isrc = cm.isrc
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
    LIMIT GREATEST(COALESCE(v_limit_rows, 200), 0);
  ELSE
    RETURN QUERY
    WITH latest_row AS (
      -- Latest membership row per ISRC for this playlist at/before run_date
      SELECT DISTINCT ON (m.isrc)
        m.isrc,
        m.valid_from::date AS valid_from,
        m.valid_to::date AS valid_to
      FROM public.playlist_memberships m
      WHERE m.playlist_key = v_playlist_key
        AND m.valid_from <= v_run_date
      ORDER BY m.isrc, m.valid_from DESC
    ),
    current_members AS (
      SELECT l.isrc, l.valid_from
      FROM latest_row l
      WHERE l.valid_to IS NULL OR l.valid_to >= v_run_date
    ),
    today AS (
      SELECT
        cm.isrc,
        COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
      FROM current_members cm
      LEFT JOIN public.track_daily_stream_overrides o
        ON o.date = v_run_date AND o.isrc = cm.isrc
      LEFT JOIN public.track_daily_streams s
        ON s.date = v_run_date AND s.isrc = cm.isrc
    ),
    prev AS (
      SELECT
        cm.isrc,
        COALESCE(o.streams_cumulative_override, s.streams_cumulative)::bigint AS streams_cumulative
      FROM current_members cm
      LEFT JOIN public.track_daily_stream_overrides o
        ON v_prev_date IS NOT NULL AND o.date = v_prev_date AND o.isrc = cm.isrc
      LEFT JOIN public.track_daily_streams s
        ON v_prev_date IS NOT NULL AND s.date = v_prev_date AND s.isrc = cm.isrc
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
    LIMIT GREATEST(COALESCE(v_limit_rows, 200), 0);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.playlist_top_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;

