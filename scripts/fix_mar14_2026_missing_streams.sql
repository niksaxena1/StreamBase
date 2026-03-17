-- One-off correction script for DATA DATE March 14th, 2026 (RUN DATE March 16th, 2026)
-- Issue: SOT didn't fetch stream counts for many tracks on data date March 14 (Saturday).
--        The `date` column in track_daily_streams stores the RUN DATE, not the data date.
--        Data date Mar 14 corresponds to run date Mar 16 (2-day lag).
--
-- V4: Simple average interpolation — (Friday + Sunday) / 2
--     Previous approaches (V1 sat_ratio, V2 global dip %, V3 per-track dip %)
--     all undershot the expected weekend dip. Simple averaging is more robust.
--
-- Run dates used:
--   Fri     data date Mar 13 -> run date Mar 15
--   Sat     data date Mar 14 -> run date Mar 16 (bad — to fix)
--   Sun     data date Mar 15 -> run date Mar 17
--
-- IMPORTANT: All reads use track_daily_streams_effective (not raw track_daily_streams)
--            so that any existing overrides on adjacent days are respected.
--
-- This script UPDATES existing overrides in track_daily_stream_overrides (from V1/V2/V3).
-- The raw data in track_daily_streams remains untouched.
--
-- Run each block separately in the Supabase SQL Editor:
--   1. Run BLOCK 1 (preview) to verify proposed values
--   2. Run BLOCK 2 (execute) to update overrides + recompute + verify


--------------------------------------------------------------------------------
-- BLOCK 1: PREVIEW (run this first to review before committing)
--------------------------------------------------------------------------------

WITH
fri AS (
  SELECT isrc, streams_cumulative AS streams
  FROM track_daily_streams_effective
  WHERE date = '2026-03-15'  -- data date Mar 13 (Fri)
),
sun AS (
  SELECT isrc, streams_cumulative AS streams
  FROM track_daily_streams_effective
  WHERE date = '2026-03-17'  -- data date Mar 15 (Sun)
),
combined AS (
  SELECT
    f.isrc,
    f.streams AS streams_fri,
    s.streams AS streams_sun,
    ROUND((f.streams + s.streams) / 2.0)::bigint AS interpolated_streams
  FROM fri f
  INNER JOIN sun s USING (isrc)
  WHERE s.streams >= f.streams  -- Sun cumulative should be >= Fri
)
SELECT
  c.isrc,
  c.streams_fri,
  o.streams_cumulative_override AS old_override,
  c.streams_sun,
  c.interpolated_streams AS new_override,
  c.interpolated_streams - COALESCE(o.streams_cumulative_override, 0) AS delta_from_old
FROM combined c
LEFT JOIN track_daily_stream_overrides o ON o.date = '2026-03-16' AND o.isrc = c.isrc
WHERE o.isrc IS NOT NULL  -- only tracks that already have overrides
ORDER BY c.isrc;


--------------------------------------------------------------------------------
-- BLOCK 2: EXECUTE (run this after verifying BLOCK 1 looks correct)
-- Updates existing overrides with simple average, recomputes, verifies.
--------------------------------------------------------------------------------

INSERT INTO track_daily_stream_overrides (date, isrc, streams_cumulative_override, note)
WITH
fri AS (
  SELECT isrc, streams_cumulative AS streams
  FROM track_daily_streams_effective
  WHERE date = '2026-03-15'
),
sun AS (
  SELECT isrc, streams_cumulative AS streams
  FROM track_daily_streams_effective
  WHERE date = '2026-03-17'
),
interpolated AS (
  SELECT
    f.isrc,
    ROUND((f.streams + s.streams) / 2.0)::bigint AS interpolated_streams
  FROM fri f
  INNER JOIN sun s USING (isrc)
  WHERE s.streams >= f.streams
    AND EXISTS (
      SELECT 1 FROM track_daily_stream_overrides o
      WHERE o.date = '2026-03-16' AND o.isrc = f.isrc
    )
)
SELECT
  '2026-03-16'::date AS date,
  isrc,
  interpolated_streams AS streams_cumulative_override,
  'Auto-corrected V4: SOT did not update stream counts for data date 2026-03-14 (Saturday, run date 2026-03-16). Interpolated as average of Fri (Mar 15) and Sun (Mar 17) cumulative values.' AS note
FROM interpolated
ON CONFLICT (date, isrc) DO UPDATE SET
  streams_cumulative_override = EXCLUDED.streams_cumulative_override,
  note = EXCLUDED.note,
  created_at = NOW();

-- Cascade recompute playlist_daily_stats from Mar 16 onward
SELECT spotibase_recompute_playlist_daily_stats_cascade('2026-03-16'::date);

-- Verify: count of overrides updated
SELECT COUNT(*) AS override_count
FROM track_daily_stream_overrides
WHERE date = '2026-03-16';

-- Verify: sample of corrected values in the effective view
SELECT
  e.isrc,
  e.streams_cumulative,
  e.is_manual_override,
  e.manual_note
FROM track_daily_streams_effective e
WHERE e.date = '2026-03-16'
  AND e.is_manual_override = true
ORDER BY e.isrc
LIMIT 20;
