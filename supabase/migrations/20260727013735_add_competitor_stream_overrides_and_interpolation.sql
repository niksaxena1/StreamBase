-- Migration: Competitor stream overrides + effective view + stale-run interpolation
--
-- Mirrors the own-catalog machinery (see add_track_daily_stream_overrides.sql):
-- - competitor.track_daily_stream_overrides: per-(date,isrc) corrections; raw snapshots untouched.
-- - competitor.track_daily_streams_effective(_public): resolved series, override wins.
-- - competitor.spotibase_interpolate_stale_streams: auto-fills "stale" runs (Spot On Track
--   not updating for 1+ days, then catching up) by linear interpolation of the cumulative
--   counter between the last good value and the catch-up value. Pure SQL, idempotent.
-- - competitor.spotibase_stale_summary: per-date staleness counts for watchdog/alerting.

-- 1) Overrides table.
CREATE TABLE IF NOT EXISTS competitor.track_daily_stream_overrides (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  isrc TEXT NOT NULL,
  streams_cumulative_override BIGINT NOT NULL,
  note TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE competitor.track_daily_stream_overrides IS 'Manual/auto per-(date,isrc) overrides for competitor.track_daily_streams.streams_cumulative. Raw snapshots remain unchanged; use track_daily_streams_effective for reads. Auto-interpolated rows carry note prefix auto-interp:.';

CREATE UNIQUE INDEX IF NOT EXISTS competitor_track_daily_stream_overrides_uq
  ON competitor.track_daily_stream_overrides (date, isrc);
CREATE INDEX IF NOT EXISTS competitor_track_daily_stream_overrides_date_idx
  ON competitor.track_daily_stream_overrides (date);
CREATE INDEX IF NOT EXISTS competitor_track_daily_stream_overrides_isrc_idx
  ON competitor.track_daily_stream_overrides (isrc);

ALTER TABLE competitor.track_daily_stream_overrides ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor.track_daily_stream_overrides TO service_role;
GRANT USAGE, SELECT ON SEQUENCE competitor.track_daily_stream_overrides_id_seq TO service_role;

-- 2) Effective view (override wins; FULL OUTER JOIN so overrides can fill missing rows).
CREATE OR REPLACE VIEW competitor.track_daily_streams_effective AS
WITH
  base AS (
    SELECT date, isrc, streams_cumulative, source_run_id, created_at AS base_created_at
    FROM competitor.track_daily_streams
  ),
  ov AS (
    SELECT date, isrc, streams_cumulative_override, note, created_by,
           created_at AS override_created_at, id AS override_id
    FROM competitor.track_daily_stream_overrides
  )
SELECT
  COALESCE(ov.date, base.date) AS date,
  COALESCE(ov.isrc, base.isrc) AS isrc,
  COALESCE(ov.streams_cumulative_override, base.streams_cumulative) AS streams_cumulative,
  base.source_run_id,
  base.base_created_at,
  (ov.override_id IS NOT NULL) AS is_manual_override,
  ov.override_id,
  ov.note AS manual_note,
  ov.override_created_at AS manual_created_at,
  ov.created_by AS manual_created_by
FROM base
FULL OUTER JOIN ov USING (date, isrc);

CREATE OR REPLACE VIEW competitor.track_daily_streams_effective_public AS
SELECT date, isrc, streams_cumulative
FROM competitor.track_daily_streams_effective;

GRANT SELECT ON competitor.track_daily_streams_effective TO service_role;
GRANT SELECT ON competitor.track_daily_streams_effective_public TO anon, authenticated, service_role;

-- 3) Invalid-run interpolation.
-- Cumulative stream counters are non-decreasing, so a snapshot is "invalid" when it is
-- <= the running maximum of all earlier snapshots for that track:
--   - equal   => stale (Spot On Track did not update that day; catches up later), or a
--                genuinely zero-stream day (interpolation then spreads the eventual
--                catch-up delta evenly, which is the best available estimate);
--   - smaller => corrupt dip (SOT briefly reported a lower cumulative; e.g. the
--                2026-06-28 Soave snapshot where 39 tracks dropped -36M then snapped back).
-- A maximal run of invalid days bounded on the left by the last valid snapshot and on the
-- right by a strictly larger catch-up snapshot is linearly interpolated. This is safe:
-- interpolated values are bounded by real observations, and totals over any window
-- spanning the run are unchanged.
--
-- Guardrails:
-- - Only runs of length <= p_max_run_days are filled (longer outages are left for review).
-- - Only fills when the immediate next snapshot is strictly greater than the anchor.
-- - Never overwrites an existing override (ON CONFLICT DO NOTHING), so manual fixes win.
CREATE OR REPLACE FUNCTION competitor.spotibase_interpolate_stale_streams(
  p_start_date DATE DEFAULT (CURRENT_DATE - 45),
  p_end_date DATE DEFAULT CURRENT_DATE,
  p_max_run_days INTEGER DEFAULT 14
)
RETURNS TABLE (overrides_written INTEGER, tracks_affected INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public
AS $$
DECLARE
  v_written INTEGER := 0;
  v_tracks INTEGER := 0;
BEGIN
  WITH series AS (
    SELECT
      isrc,
      date,
      streams_cumulative,
      -- Running max of all STRICTLY EARLIER snapshots (frame excludes current row).
      MAX(streams_cumulative) OVER (
        PARTITION BY isrc ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prev_max
    FROM competitor.track_daily_streams
    -- One day of left context so a run starting exactly at p_start_date is detected.
    WHERE date >= p_start_date - 1 AND date <= p_end_date
  ),
  flagged AS (
    SELECT
      isrc,
      date,
      streams_cumulative,
      (prev_max IS NOT NULL AND streams_cumulative <= prev_max) AS is_bad,
      -- Group id: each valid row starts a new group; invalid rows attach to the
      -- preceding valid row's group.
      SUM(CASE WHEN prev_max IS NULL OR streams_cumulative > prev_max THEN 1 ELSE 0 END)
        OVER (PARTITION BY isrc ORDER BY date) AS grp
    FROM series
  ),
  runs AS (
    SELECT
      isrc,
      grp,
      MIN(date) FILTER (WHERE NOT is_bad) AS anchor_date,
      MAX(streams_cumulative) FILTER (WHERE NOT is_bad) AS anchor_cum,
      MIN(date) FILTER (WHERE is_bad) AS stale_start,
      MAX(date) FILTER (WHERE is_bad) AS stale_end,
      COUNT(*) FILTER (WHERE is_bad) AS stale_days
    FROM flagged
    GROUP BY isrc, grp
    HAVING COUNT(*) FILTER (WHERE is_bad) > 0
  ),
  bounded AS (
    SELECT
      r.isrc,
      r.anchor_date,
      r.anchor_cum,
      r.stale_start,
      r.stale_end,
      r.stale_days,
      nxt.date AS next_date,
      nxt.streams_cumulative AS next_cum
    FROM runs r
    CROSS JOIN LATERAL (
      SELECT t.date, t.streams_cumulative
      FROM competitor.track_daily_streams t
      WHERE t.isrc = r.isrc
        AND t.date > r.stale_end
        AND t.streams_cumulative > r.anchor_cum
      ORDER BY t.date
      LIMIT 1
    ) nxt
    WHERE r.anchor_date IS NOT NULL
      AND r.stale_days <= p_max_run_days
      -- The catch-up must be the immediate next snapshot; a later gap means the
      -- series is unreliable there and we leave it alone.
      AND nxt.date = r.stale_end + 1
  ),
  candidate_rows AS (
    SELECT
      b.isrc,
      gs.d::date AS date,
      -- Linear interpolation of the cumulative counter between the anchors.
      ROUND(
        b.anchor_cum
        + (b.next_cum - b.anchor_cum)::numeric
          * (gs.d::date - b.anchor_date)::numeric
          / NULLIF((b.next_date - b.anchor_date), 0)::numeric
      )::bigint AS interp_cum
    FROM bounded b
    CROSS JOIN LATERAL generate_series(b.stale_start, b.stale_end, INTERVAL '1 day') gs(d)
    WHERE gs.d::date >= p_start_date
  ),
  inserted AS (
    INSERT INTO competitor.track_daily_stream_overrides (date, isrc, streams_cumulative_override, note)
    SELECT c.date, c.isrc, c.interp_cum, 'auto-interp:v1'
    FROM candidate_rows c
    ON CONFLICT (date, isrc) DO NOTHING
    RETURNING isrc
  )
  SELECT COUNT(*)::int, COUNT(DISTINCT isrc)::int INTO v_written, v_tracks FROM inserted;

  RETURN QUERY SELECT v_written, v_tracks;
END;
$$;

COMMENT ON FUNCTION competitor.spotibase_interpolate_stale_streams(date, date, integer) IS 'Fill bounded stale runs (delta=0 followed by a strictly larger catch-up snapshot) in competitor.track_daily_streams with linearly interpolated overrides (note auto-interp:v1). Idempotent; never overwrites existing overrides.';

REVOKE ALL ON FUNCTION competitor.spotibase_interpolate_stale_streams(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.spotibase_interpolate_stale_streams(date, date, integer) TO service_role;

-- 4) Staleness summary for a run date (used by the competitor watchdog / export alerting).
CREATE OR REPLACE FUNCTION competitor.spotibase_stale_summary(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  snapshot_tracks BIGINT,
  stale_raw BIGINT,
  stale_effective BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = competitor, public
AS $$
  WITH today_raw AS (
    SELECT isrc, streams_cumulative FROM competitor.track_daily_streams WHERE date = p_date
  ),
  prev_raw AS (
    SELECT isrc, streams_cumulative FROM competitor.track_daily_streams WHERE date = p_date - 1
  ),
  today_eff AS (
    SELECT isrc, streams_cumulative FROM competitor.track_daily_streams_effective_public WHERE date = p_date
  ),
  prev_eff AS (
    SELECT isrc, streams_cumulative FROM competitor.track_daily_streams_effective_public WHERE date = p_date - 1
  )
  SELECT
    (SELECT COUNT(*) FROM today_raw) AS snapshot_tracks,
    (SELECT COUNT(*) FROM today_raw t JOIN prev_raw p USING (isrc)
      WHERE t.streams_cumulative = p.streams_cumulative) AS stale_raw,
    (SELECT COUNT(*) FROM today_eff t JOIN prev_eff p USING (isrc)
      WHERE t.streams_cumulative = p.streams_cumulative) AS stale_effective;
$$;

COMMENT ON FUNCTION competitor.spotibase_stale_summary(date) IS 'Counts of competitor tracks whose cumulative snapshot did not move vs the previous day, raw and after overrides. High stale_effective means the interpolation pass has not (yet) covered the staleness.';

REVOKE ALL ON FUNCTION competitor.spotibase_stale_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.spotibase_stale_summary(date) TO service_role;
