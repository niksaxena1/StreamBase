-- Backfill: rename old "RapidAPI fallback (...)" override notes to use the
-- "stale-fix: " prefix so the "hide stale override annotations" setting
-- correctly filters them on charts.
--
-- This is safe to run multiple times (idempotent).

UPDATE track_daily_stream_overrides
SET note = 'stale-fix: ' || note
WHERE (
    note LIKE 'RapidAPI fallback%'
    OR note = 'SOT didn''t update, stale, manually fixed'
  )
  AND note NOT LIKE 'stale-fix:%';
