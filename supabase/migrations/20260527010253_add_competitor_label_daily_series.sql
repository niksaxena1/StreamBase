-- Label-level daily series for /competitors (replaces per-playlist fetch + JS aggregation).

CREATE OR REPLACE FUNCTION competitor.label_daily_series(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  date DATE,
  label_key TEXT,
  daily_streams_net BIGINT,
  total_streams_cumulative BIGINT,
  track_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.date,
    p.label_key,
    SUM(COALESCE(s.daily_streams_net, 0))::bigint AS daily_streams_net,
    SUM(COALESCE(s.total_streams_cumulative, 0))::bigint AS total_streams_cumulative,
    SUM(COALESCE(s.track_count, 0))::bigint AS track_count
  FROM competitor.playlist_daily_stats s
  JOIN competitor.playlists p ON p.playlist_key = s.playlist_key
  WHERE s.date >= p_start_date
    AND s.date <= p_end_date
  GROUP BY s.date, p.label_key
  ORDER BY s.date ASC, p.label_key ASC;
$$;

ALTER FUNCTION competitor.label_daily_series(DATE, DATE) SET search_path = competitor, public;

COMMENT ON FUNCTION competitor.label_daily_series(DATE, DATE) IS
  'Aggregated per-label daily stats for competitor comparison charts (run dates).';
