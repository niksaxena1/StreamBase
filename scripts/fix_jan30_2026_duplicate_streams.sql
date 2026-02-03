-- One-off correction script for DATA DATE January 30th, 2026 (RUN DATE February 1st, 2026)
-- Issue: SOT didn't update stream counts for data date Jan 30, resulting in duplicate values
--        The `date` column in track_daily_streams stores the RUN DATE, not the data date.
--        Data date Jan 30 corresponds to run date Feb 1 (2-day lag).
-- Solution: Interpolate streams as the average of January 31st and February 2nd (surrounding run dates)
--
-- This script creates manual overrides in track_daily_stream_overrides
-- The raw data in track_daily_streams remains untouched
--
-- ALREADY APPLIED on 2026-02-03
--
-- Run this in your Supabase SQL Editor.

-- Step 1: Preview what will be inserted (run this first to verify)
WITH jan31 AS (
  SELECT isrc, streams_cumulative AS streams_31
  FROM track_daily_streams
  WHERE date = '2026-01-31'
),
feb01 AS (
  SELECT isrc, streams_cumulative AS streams_01
  FROM track_daily_streams
  WHERE date = '2026-02-01'
),
feb02 AS (
  SELECT isrc, streams_cumulative AS streams_02
  FROM track_daily_streams
  WHERE date = '2026-02-02'
),
combined AS (
  SELECT
    COALESCE(j31.isrc, f01.isrc, f02.isrc) AS isrc,
    j31.streams_31,
    f01.streams_01,
    f02.streams_02,
    -- Average of day before and day after, rounded to nearest integer
    ROUND((COALESCE(j31.streams_31, 0) + COALESCE(f02.streams_02, 0)) / 2.0)::bigint AS interpolated_streams
  FROM jan31 j31
  FULL OUTER JOIN feb01 f01 USING (isrc)
  FULL OUTER JOIN feb02 f02 USING (isrc)
)
SELECT
  isrc,
  streams_31,
  streams_01,
  streams_02,
  interpolated_streams,
  (streams_01 = streams_31) AS was_duplicate,
  (interpolated_streams - streams_01) AS correction_delta
FROM combined
WHERE streams_31 IS NOT NULL AND streams_02 IS NOT NULL
ORDER BY isrc;

-- Step 2: Insert the overrides (uncomment and run after verifying preview above)
/*
INSERT INTO track_daily_stream_overrides (date, isrc, streams_cumulative_override, note)
WITH jan31 AS (
  SELECT isrc, streams_cumulative AS streams_31
  FROM track_daily_streams
  WHERE date = '2026-01-31'
),
feb02 AS (
  SELECT isrc, streams_cumulative AS streams_02
  FROM track_daily_streams
  WHERE date = '2026-02-02'
),
interpolated AS (
  SELECT
    j31.isrc,
    ROUND((j31.streams_31 + f02.streams_02) / 2.0)::bigint AS interpolated_streams
  FROM jan31 j31
  INNER JOIN feb02 f02 USING (isrc)
)
SELECT
  '2026-02-01'::date AS date,
  isrc,
  interpolated_streams AS streams_cumulative_override,
  'Auto-corrected: SOT did not update stream counts for data date 2026-01-30 (run date 2026-02-01). Interpolated as average of 2026-01-31 and 2026-02-02.' AS note
FROM interpolated
ON CONFLICT (date, isrc) DO UPDATE SET
  streams_cumulative_override = EXCLUDED.streams_cumulative_override,
  note = EXCLUDED.note,
  created_at = NOW();
*/

-- Step 3: After inserting overrides, recompute playlist_daily_stats for Feb 1st
-- (uncomment and run after Step 2)
/*
SELECT spotibase_recompute_playlist_daily_stats('2026-02-01'::date);
*/

-- Step 4: Verify the overrides were created
/*
SELECT * FROM track_daily_stream_overrides WHERE date = '2026-02-01' ORDER BY isrc;
*/

-- Step 5: Verify the effective view now shows interpolated values
/*
SELECT
  e.isrc,
  e.streams_cumulative,
  e.is_manual_override,
  e.manual_note
FROM track_daily_streams_effective e
WHERE e.date = '2026-02-01'
ORDER BY e.isrc;
*/
