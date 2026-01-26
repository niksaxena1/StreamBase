-- Migration: Collector aggregation views for /collectors
-- Run this in your Supabase SQL Editor

-- Aggregate playlist_daily_stats per collector per day
DROP VIEW IF EXISTS collector_daily_agg;
CREATE VIEW collector_daily_agg AS
SELECT
  p.collector,
  s.date,
  SUM(COALESCE(s.track_count, 0))::bigint AS track_count,
  SUM(COALESCE(s.total_streams_cumulative, 0))::bigint AS total_streams_cumulative,
  SUM(COALESCE(s.daily_streams_net, 0))::bigint AS daily_streams_net,
  SUM(COALESCE(s.est_revenue_total, 0))::numeric AS est_revenue_total,
  SUM(COALESCE(s.est_revenue_daily_net, 0))::numeric AS est_revenue_daily_net,
  SUM(COALESCE(s.missing_streams_track_count, 0))::bigint AS missing_streams_track_count
FROM playlists p
JOIN playlist_daily_stats s
  ON s.playlist_key = p.playlist_key
WHERE p.collector IS NOT NULL
GROUP BY p.collector, s.date;

COMMENT ON VIEW collector_daily_agg IS 'Daily aggregated stats per collector across assigned playlists';

-- Windowed comparison metrics (yesterday delta + delta vs prev-7d avg)
DROP VIEW IF EXISTS collector_daily_compare;
CREATE VIEW collector_daily_compare AS
SELECT
  collector,
  date,
  track_count,
  total_streams_cumulative,
  daily_streams_net,
  est_revenue_total,
  est_revenue_daily_net,
  missing_streams_track_count,

  (daily_streams_net - LAG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date))::bigint
    AS daily_streams_delta_yday,
  (est_revenue_daily_net - LAG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date))::numeric
    AS est_revenue_daily_delta_yday,
  (track_count - LAG(track_count) OVER (PARTITION BY collector ORDER BY date))::bigint
    AS track_count_delta_yday,

  AVG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS daily_streams_ma7_prev,
  AVG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS est_revenue_daily_ma7_prev,
  AVG(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS track_count_ma7_prev,

  (daily_streams_net - AVG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::bigint
    AS daily_streams_delta_ma7,
  (est_revenue_daily_net - AVG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::numeric
    AS est_revenue_daily_delta_ma7,
  (track_count - AVG(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::numeric
    AS track_count_delta_ma7
FROM collector_daily_agg;

COMMENT ON VIEW collector_daily_compare IS 'Daily aggregated stats per collector with window comparisons (yday + prev-7d avg)';

