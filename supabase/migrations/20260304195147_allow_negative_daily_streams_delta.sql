-- Remove GREATEST(0,...) clamp from daily stream delta calculations.
-- Negative deltas are legitimate (reporting corrections, deduplication, fraud filtering)
-- and should be surfaced so users can investigate them.

-- 1) home_track_scatter_points
CREATE OR REPLACE FUNCTION public.home_track_scatter_points(p_run_date date, p_prev_date date)
 RETURNS TABLE(isrc text, name text, release_date date, artist_names text[], artist_ids text[], album_image_url text, total_streams_cumulative bigint, daily_streams_delta bigint, has_prev_day boolean)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    t.isrc,
    t.name,
    t.release_date,
    t.spotify_artist_names   AS artist_names,
    t.spotify_artist_ids     AS artist_ids,
    t.spotify_album_image_url AS album_image_url,
    COALESCE(today.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN prev.streams_cumulative IS NOT NULL
      THEN (COALESCE(today.streams_cumulative, 0) - prev.streams_cumulative)::bigint
      ELSE 0::bigint
    END AS daily_streams_delta,
    prev.streams_cumulative IS NOT NULL AS has_prev_day
  FROM track_daily_streams_effective_public today
  JOIN tracks t ON t.isrc = today.isrc
  LEFT JOIN track_daily_streams_effective_public prev
    ON prev.isrc = today.isrc AND prev.date = p_prev_date
  WHERE today.date = p_run_date
  ORDER BY today.streams_cumulative DESC NULLS LAST;
$function$;

-- 2) catalog_artist_top_tracks_total
CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_total(artist_id text, run_date date, limit_rows integer DEFAULT 25)
 RETURNS TABLE(isrc text, name text, album_image_url text, total bigint, daily bigint)
 LANGUAGE sql
 STABLE
AS $function$
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
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    (t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$function$;

-- 3) catalog_artist_top_tracks_daily
CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_daily(artist_id text, run_date date, limit_rows integer DEFAULT 25)
 RETURNS TABLE(isrc text, name text, album_image_url text, total bigint, daily bigint)
 LANGUAGE sql
 STABLE
AS $function$
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
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    (t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY daily DESC, total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$function$;

-- 4) playlist_top_tracks (plpgsql, two branches: all_catalog + normal)
CREATE OR REPLACE FUNCTION public.playlist_top_tracks(playlist_key text, run_date date, prev_date date DEFAULT NULL::date, limit_rows integer DEFAULT 200)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_names text[], artist_ids text[], valid_from date, total bigint, daily bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_playlist_key TEXT := playlist_key;
  v_run_date DATE := run_date;
  v_prev_date DATE := prev_date;
  v_limit_rows INT := limit_rows;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  IF v_playlist_key = 'all_catalog' THEN
    RETURN QUERY
    WITH latest_per_playlist AS (
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
        ELSE (td.streams_cumulative - pv.streams_cumulative)::bigint
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
        ELSE (td.streams_cumulative - pv.streams_cumulative)::bigint
      END AS daily
    FROM current_members cm
    LEFT JOIN public.tracks t USING (isrc)
    LEFT JOIN today td USING (isrc)
    LEFT JOIN prev pv USING (isrc)
    ORDER BY daily DESC NULLS LAST, total DESC NULLS LAST, name ASC
    LIMIT GREATEST(COALESCE(v_limit_rows, 200), 0);
  END IF;
END;
$function$;

-- Re-affirm grants
GRANT EXECUTE ON FUNCTION public.home_track_scatter_points(DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_total(TEXT, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_daily(TEXT, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playlist_top_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;
