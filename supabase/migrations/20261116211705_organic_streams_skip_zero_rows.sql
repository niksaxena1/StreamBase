-- Organic daily streams: treat a stream row of 0 like a missing row. Takedowns report 0 forever after
-- (e.g. 01 Oct 2026, several N/PL tracks went from millions to 0), and a 0 -> N restore would add the
-- whole lifetime back. Both sides must be > 0 for a track to count. A brand-new track's first day is skipped.

CREATE OR REPLACE FUNCTION public.spotibase_recompute_playlist_daily_stats(p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev_date DATE := (p_date - INTERVAL '1 day')::date;
  v_rate NUMERIC := public.spotibase_stream_payout_rate();
BEGIN
  WITH
    run AS (
      SELECT id AS run_id
      FROM public.ingestion_runs
      WHERE run_date = p_date
      LIMIT 1
    ),
    active AS (
      SELECT pm.playlist_key, pm.isrc
      FROM public.playlist_memberships pm
      WHERE pm.valid_from <= p_date
        AND (pm.valid_to IS NULL OR pm.valid_to >= p_date)
    ),
    active_with_all AS (
      SELECT playlist_key, isrc FROM active
      UNION ALL
      SELECT 'all_catalog'::text AS playlist_key, isrc
      FROM active
      WHERE playlist_key IN ('releases', 'ext')
    ),
    dedup AS (
      SELECT playlist_key, isrc
      FROM active_with_all
      GROUP BY playlist_key, isrc
    ),
    -- Same membership rules for the previous day (all_catalog derived the same way).
    active_prev AS (
      SELECT pm.playlist_key, pm.isrc
      FROM public.playlist_memberships pm
      WHERE pm.valid_from <= v_prev_date
        AND (pm.valid_to IS NULL OR pm.valid_to >= v_prev_date)
    ),
    dedup_prev AS (
      SELECT playlist_key, isrc FROM active_prev
      UNION
      SELECT 'all_catalog'::text AS playlist_key, isrc
      FROM active_prev
      WHERE playlist_key IN ('releases', 'ext')
    ),
    organic AS (
      SELECT d.playlist_key, SUM(t.streams_cumulative - y.streams_cumulative)::bigint AS organic
      FROM dedup d
      JOIN dedup_prev dp
        ON dp.playlist_key = d.playlist_key AND dp.isrc = d.isrc
      JOIN public.track_daily_streams_effective_public t
        ON t.date = p_date AND t.isrc = d.isrc
      JOIN public.track_daily_streams_effective_public y
        ON y.date = v_prev_date AND y.isrc = d.isrc
      WHERE t.streams_cumulative > 0
        AND y.streams_cumulative > 0
      GROUP BY d.playlist_key
    ),
    prev_totals AS (
      SELECT playlist_key, total_streams_cumulative AS prev_total
      FROM public.playlist_daily_stats
      WHERE date = v_prev_date
    ),
    computed AS (
      SELECT
        p_date AS date,
        d.playlist_key,
        COUNT(*)::int AS track_count,
        COALESCE(SUM(t.streams_cumulative), 0)::bigint AS total_streams_cumulative,
        -- Missing = tracks in membership snapshot without a stream snapshot row.
        COUNT(*) FILTER (WHERE t.streams_cumulative IS NULL)::int AS missing_streams_track_count,
        CASE WHEN pt.prev_total IS NULL THEN NULL
             ELSE (COALESCE(SUM(t.streams_cumulative), 0)::bigint - pt.prev_total::bigint) END AS daily_streams_net,
        (COALESCE(SUM(t.streams_cumulative), 0)::numeric * v_rate) AS est_revenue_total,
        CASE WHEN pt.prev_total IS NULL THEN NULL
             ELSE ((COALESCE(SUM(t.streams_cumulative), 0)::bigint - pt.prev_total::bigint)::numeric * v_rate) END AS est_revenue_daily_net
      FROM dedup d
      LEFT JOIN public.track_daily_streams_effective_public t
        ON t.date = p_date AND t.isrc = d.isrc
      LEFT JOIN prev_totals pt
        ON pt.playlist_key = d.playlist_key
      GROUP BY d.playlist_key, pt.prev_total
    ),
    with_organic AS (
      SELECT
        c.*,
        CASE WHEN c.daily_streams_net IS NULL THEN NULL
             ELSE COALESCE(o.organic, 0) END AS daily_streams_organic
      FROM computed c
      LEFT JOIN organic o ON o.playlist_key = c.playlist_key
    )
  INSERT INTO public.playlist_daily_stats (
    date,
    playlist_key,
    track_count,
    total_streams_cumulative,
    daily_streams_net,
    est_revenue_total,
    est_revenue_daily_net,
    missing_streams_track_count,
    daily_streams_organic,
    est_revenue_daily_organic,
    source_run_id
  )
  SELECT
    c.date,
    c.playlist_key,
    c.track_count,
    c.total_streams_cumulative,
    c.daily_streams_net,
    c.est_revenue_total,
    c.est_revenue_daily_net,
    c.missing_streams_track_count,
    c.daily_streams_organic,
    (c.daily_streams_organic::numeric * v_rate),
    (SELECT run_id FROM run) AS source_run_id
  FROM with_organic c
  ON CONFLICT (date, playlist_key) DO UPDATE SET
    track_count = EXCLUDED.track_count,
    total_streams_cumulative = EXCLUDED.total_streams_cumulative,
    daily_streams_net = EXCLUDED.daily_streams_net,
    est_revenue_total = EXCLUDED.est_revenue_total,
    est_revenue_daily_net = EXCLUDED.est_revenue_daily_net,
    missing_streams_track_count = EXCLUDED.missing_streams_track_count,
    daily_streams_organic = EXCLUDED.daily_streams_organic,
    est_revenue_daily_organic = EXCLUDED.est_revenue_daily_organic,
    source_run_id = EXCLUDED.source_run_id;
END;
$function$;
