-- Migration: Optimize playlist_top_tracks to avoid statement timeouts
--
-- Symptom:
-- /playlists "Tracks currently in playlist" shows:
--   canceling statement due to statement timeout
--
-- Root cause:
-- The previous implementation joined against `track_daily_streams_effective_public`
-- (a view), which can prevent efficient index usage and cause large scans.
--
-- Fix:
-- 1) First compute the active ISRC set *at run_date* (using DISTINCT ON for "latest add").
-- 2) Then fetch streams for just those ISRCs from:
--    - track_daily_streams (indexed by date+isrc)
--    - track_daily_stream_overrides (PK by date+isrc)
--    with override precedence.
-- 3) Keep behavior for 'all_catalog' = union of ('releases','ext').

-- Helpful index for active membership lookup (works regardless of valid_to nullness).
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
LANGUAGE sql
STABLE
AS $$
  WITH active_memberships AS (
    -- Active memberships at run_date, handling 'all_catalog' as union.
    SELECT m.isrc, m.valid_from::date AS valid_from
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)

    UNION ALL
    SELECT m.isrc, m.valid_from::date AS valid_from
    FROM public.playlist_memberships m
    WHERE $1 = 'all_catalog'
      AND m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  current_members AS (
    -- For each ISRC, use the latest valid_from among active memberships (remove/re-add safe).
    SELECT DISTINCT ON (a.isrc)
      a.isrc,
      a.valid_from
    FROM active_memberships a
    ORDER BY a.isrc, a.valid_from DESC
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

