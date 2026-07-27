-- Migration: Recompute competitor.playlist_daily_stats from the effective streams view
--
-- competitor.playlist_daily_stats is written at ingest time from raw Spot On Track
-- exports, so stream overrides (manual or auto-interp) never reached the playlist-level
-- charts (e.g. the competitor overview daily-streams graph). These functions mirror the
-- own-catalog pair (spotibase_recompute_playlist_daily_stats(_cascade)) minus the
-- own-specific all_catalog synthetic playlist.

CREATE OR REPLACE FUNCTION competitor.spotibase_recompute_playlist_daily_stats(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public
AS $$
DECLARE
  v_prev_date DATE := (p_date - INTERVAL '1 day')::date;
BEGIN
  WITH
    run AS (
      SELECT id AS run_id FROM competitor.ingestion_runs WHERE run_date = p_date LIMIT 1
    ),
    active AS (
      SELECT pm.playlist_key, pm.isrc
      FROM competitor.playlist_memberships pm
      WHERE pm.valid_from <= p_date
        AND (pm.valid_to IS NULL OR pm.valid_to >= p_date)
      GROUP BY pm.playlist_key, pm.isrc
    ),
    prev_totals AS (
      SELECT playlist_key, total_streams_cumulative AS prev_total
      FROM competitor.playlist_daily_stats
      WHERE date = v_prev_date
    ),
    computed AS (
      SELECT
        p_date AS date,
        d.playlist_key,
        COUNT(*)::int AS track_count,
        COALESCE(SUM(t.streams_cumulative), 0)::bigint AS total_streams_cumulative,
        COUNT(*) FILTER (WHERE t.streams_cumulative IS NULL)::int AS missing_streams_track_count,
        (COALESCE(SUM(t.streams_cumulative), 0)::bigint - COALESCE(pt.prev_total, 0)::bigint) AS daily_streams_net,
        (COALESCE(SUM(t.streams_cumulative), 0)::numeric * 0.002) AS est_revenue_total,
        ((COALESCE(SUM(t.streams_cumulative), 0)::bigint - COALESCE(pt.prev_total, 0)::bigint)::numeric * 0.002) AS est_revenue_daily_net
      FROM active d
      LEFT JOIN competitor.track_daily_streams_effective_public t
        ON t.date = p_date AND t.isrc = d.isrc
      LEFT JOIN prev_totals pt
        ON pt.playlist_key = d.playlist_key
      GROUP BY d.playlist_key, pt.prev_total
    )
  INSERT INTO competitor.playlist_daily_stats (
    date, playlist_key, track_count, total_streams_cumulative, daily_streams_net,
    est_revenue_total, est_revenue_daily_net, missing_streams_track_count, source_run_id
  )
  SELECT
    c.date, c.playlist_key, c.track_count, c.total_streams_cumulative, c.daily_streams_net,
    c.est_revenue_total, c.est_revenue_daily_net, c.missing_streams_track_count,
    (SELECT run_id FROM run)
  FROM computed c
  ON CONFLICT (date, playlist_key) DO UPDATE SET
    track_count = EXCLUDED.track_count,
    total_streams_cumulative = EXCLUDED.total_streams_cumulative,
    daily_streams_net = EXCLUDED.daily_streams_net,
    est_revenue_total = EXCLUDED.est_revenue_total,
    est_revenue_daily_net = EXCLUDED.est_revenue_daily_net,
    missing_streams_track_count = EXCLUDED.missing_streams_track_count,
    source_run_id = EXCLUDED.source_run_id;
END;
$$;

COMMENT ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats(date) IS 'Rebuild competitor.playlist_daily_stats for one date from track_daily_streams_effective_public (incorporating overrides). Run after interpolation so playlist-level charts reflect corrected data.';

CREATE OR REPLACE FUNCTION competitor.spotibase_recompute_playlist_daily_stats_cascade(
  p_start_date DATE,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public
AS $$
DECLARE
  v_d DATE := p_start_date;
  v_n INTEGER := 0;
BEGIN
  WHILE v_d <= p_end_date LOOP
    PERFORM competitor.spotibase_recompute_playlist_daily_stats(v_d);
    v_n := v_n + 1;
    v_d := v_d + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats_cascade(date, date) IS 'Recompute competitor.playlist_daily_stats forward from p_start_date so the daily_streams_net delta chain stays consistent.';

REVOKE ALL ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats_cascade(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats(date) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.spotibase_recompute_playlist_daily_stats_cascade(date, date) TO service_role;
