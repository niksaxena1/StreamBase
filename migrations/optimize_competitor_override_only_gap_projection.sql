-- Follow-up to fix_competitor_override_only_gap_days.sql.
-- Emit unoverridden raw observations plus every override exactly once.
-- This avoids probing the partitioned raw table for each override-only row.
CREATE OR REPLACE VIEW competitor.track_daily_streams_effective_public AS
SELECT t.date,t.isrc,t.streams_cumulative
FROM competitor.track_daily_streams t
WHERE NOT EXISTS (
 SELECT 1 FROM competitor.track_daily_stream_overrides o
 WHERE o.date=t.date AND o.isrc=t.isrc
)
UNION ALL
SELECT o.date,o.isrc,o.streams_cumulative_override AS streams_cumulative
FROM competitor.track_daily_stream_overrides o;
