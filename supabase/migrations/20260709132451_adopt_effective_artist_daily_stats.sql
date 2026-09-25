-- Migration: Adopt effective stream overrides for artist daily stats
--
-- Goal:
-- - Keep Catalog artist drilldowns consistent with manual stream overrides.
-- - `artist_daily_stats` backs `catalog_artist_series_fast`; it must be built
--   from the same resolved stream source as track and playlist views.
-- - Extend the override recompute cascade so future manual overrides refresh
--   artist summaries as well as playlist summaries.

CREATE OR REPLACE FUNCTION public.refresh_artist_daily_stats(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  DELETE FROM public.artist_daily_stats s
  WHERE (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date);

  INSERT INTO public.artist_daily_stats (
    date,
    artist_id,
    artist_name,
    streams_cumulative,
    track_count,
    updated_at
  )
  SELECT
    s.date,
    a.artist_id,
    MAX(NULLIF(a.artist_name, '')) AS artist_name,
    SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative,
    COUNT(DISTINCT t.isrc)::integer AS track_count,
    NOW() AS updated_at
  FROM public.track_daily_streams_effective_public s
  JOIN public.tracks t USING (isrc)
  CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
  WHERE a.artist_id IS NOT NULL
    AND btrim(a.artist_id) <> ''
    AND (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date)
  GROUP BY s.date, a.artist_id;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_artist_daily_stats(DATE, DATE)
IS 'Refresh artist_daily_stats from track_daily_streams_effective_public so manual stream overrides are reflected in Catalog artist series.';

REVOKE EXECUTE ON FUNCTION public.refresh_artist_daily_stats(DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_artist_daily_stats(DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.catalog_artist_series_fast(
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
SET search_path = ''
AS $$
  WITH summary_rows AS (
    SELECT s.date, s.streams_cumulative
    FROM public.artist_daily_stats s
    WHERE s.artist_id = $1
      AND s.date BETWEEN $2 AND $3
  ),
  missing_dates AS (
    SELECT gs.d::date AS date
    FROM generate_series($2, $3, INTERVAL '1 day') AS gs(d)
    WHERE NOT EXISTS (
      SELECT 1
      FROM summary_rows sr
      WHERE sr.date = gs.d::date
    )
  ),
  artist_isrcs AS (
    SELECT t.isrc
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[$1]::text[]
  ),
  effective_rows AS (
    SELECT
      s.date,
      SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    JOIN missing_dates md ON md.date = s.date
    JOIN artist_isrcs a USING (isrc)
    GROUP BY s.date
  )
  SELECT summary_rows.date, summary_rows.streams_cumulative FROM summary_rows
  UNION ALL
  SELECT effective_rows.date, effective_rows.streams_cumulative FROM effective_rows
  ORDER BY 1 ASC;
$$;

COMMENT ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE)
IS 'Fast Catalog artist series using artist_daily_stats, with effective stream fallback for missing summary dates.';

GRANT EXECUTE ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(
  p_start_date DATE,
  p_end_date   DATE DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_end   DATE;
  v_d     DATE;
  v_count INT := 0;
BEGIN
  v_end := COALESCE(p_end_date, (SELECT MAX(date) FROM public.playlist_daily_stats));

  IF v_end IS NULL THEN
    PERFORM public.spotibase_recompute_playlist_daily_stats(p_start_date);
    PERFORM public.refresh_artist_daily_stats(p_start_date, p_start_date);
    RETURN 1;
  END IF;

  IF v_end < p_start_date THEN
    PERFORM public.spotibase_recompute_playlist_daily_stats(p_start_date);
    PERFORM public.refresh_artist_daily_stats(p_start_date, p_start_date);
    RETURN 1;
  END IF;

  FOR v_d IN
    SELECT DISTINCT d.dt
    FROM (
      SELECT p_start_date AS dt
      UNION
      SELECT date AS dt
      FROM public.playlist_daily_stats
      WHERE date >= p_start_date AND date <= v_end
    ) d
    ORDER BY d.dt ASC
  LOOP
    PERFORM public.spotibase_recompute_playlist_daily_stats(v_d);
    v_count := v_count + 1;
  END LOOP;

  PERFORM public.refresh_artist_daily_stats(p_start_date, v_end);

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE)
IS 'Recompute playlist_daily_stats from p_start_date to p_end_date and refresh artist_daily_stats from the effective stream view.';

GRANT EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) TO authenticated, service_role;
