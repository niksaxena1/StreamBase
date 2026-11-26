-- Requires 20261010175831_add_artist_tools_source.sql. Own catalog only.
BEGIN;

CREATE OR REPLACE VIEW public.artist_tools_vs_sot_daily
WITH (security_invoker = true) AS
SELECT
  a.date,
  count(*) AS observed_tracks,
  count(s.date) AS matched_tracks,
  count(*) FILTER (WHERE a.streams = s.streams_cumulative) AS equal_same_day,
  count(*) FILTER (WHERE a.streams = p.streams_cumulative) AS equal_prev_day,
  count(*) FILTER (WHERE a.streams > s.streams_cumulative) AS higher_than_sot,
  count(*) FILTER (WHERE a.streams < s.streams_cumulative) AS lower_than_sot,
  coalesce(sum(a.streams - s.streams_cumulative) FILTER (WHERE s.date IS NOT NULL), 0) AS sum_diff,
  min(a.observed_at) AS observed_from,
  max(a.observed_at) AS observed_to,
  min(a.observed_at) >= ((a.date + time '15:00:00') AT TIME ZONE 'UTC') AS late_read
FROM public.artist_tools_track_streams a
LEFT JOIN public.track_daily_streams s
  ON s.isrc = a.isrc AND s.date = a.date
  AND s.date >= current_date - 60
LEFT JOIN public.track_daily_streams p
  ON p.isrc = a.isrc AND p.date = a.date - 1
  AND p.date >= current_date - 61
WHERE a.date >= current_date - 60
  -- Stay inside the hot daily partitions (previous-day lookup included).
  AND a.date > public.stream_history_hot_from()
GROUP BY a.date;

REVOKE ALL ON public.artist_tools_vs_sot_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.artist_tools_vs_sot_daily TO service_role;

COMMENT ON VIEW public.artist_tools_vs_sot_daily IS
  'Service-role daily source comparison for the last 60 days, including previous-day lag and a 15:00 UTC read cutoff. sum_diff is zero when no same-day SOT rows match.';

COMMIT;
