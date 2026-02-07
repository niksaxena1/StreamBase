-- Migration: Data integrity constraints & fixes
-- Addresses: cascade recompute, atomic override removal, FK constraints,
-- overlapping membership prevention, CHECK constraints, and data cleanup.
--
-- Applied in parts via Supabase migration system. This file is the combined reference.

-- ============================================================================
-- PART 1: Cascade recompute RPC
-- When a manual override changes a date, all subsequent dates' daily_streams_net
-- become stale. This function recomputes sequentially from start_date to end_date.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(
  p_start_date DATE,
  p_end_date   DATE DEFAULT NULL
)
RETURNS INT  -- number of days recomputed
LANGUAGE plpgsql
AS $$
DECLARE
  v_end   DATE;
  v_d     DATE;
  v_count INT := 0;
BEGIN
  -- Determine end date: use provided value or max date in stats table.
  v_end := COALESCE(p_end_date, (SELECT MAX(date) FROM public.playlist_daily_stats));

  -- If no stats exist at all, just recompute the start date.
  IF v_end IS NULL THEN
    PERFORM public.spotibase_recompute_playlist_daily_stats(p_start_date);
    RETURN 1;
  END IF;

  -- If end < start, just recompute the start date.
  IF v_end < p_start_date THEN
    PERFORM public.spotibase_recompute_playlist_daily_stats(p_start_date);
    RETURN 1;
  END IF;

  -- Recompute each day that has stats (plus the start date), sequentially.
  -- Sequential order is critical: each day reads prev_total from the day before.
  FOR v_d IN
    SELECT DISTINCT d.dt
    FROM (
      -- Always include the start date (may not have stats yet)
      SELECT p_start_date AS dt
      UNION
      -- All dates with existing stats in the range
      SELECT date AS dt
      FROM public.playlist_daily_stats
      WHERE date >= p_start_date AND date <= v_end
    ) d
    ORDER BY d.dt ASC
  LOOP
    PERFORM public.spotibase_recompute_playlist_daily_stats(v_d);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE)
IS 'Recompute playlist_daily_stats from p_start_date to p_end_date (default: latest), cascading daily_streams_net forward.';

GRANT EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) TO authenticated;

-- ============================================================================
-- PART 2: Atomic override removal RPC
-- Deletes an override AND cascade-recomputes in a single transaction.
-- If either step fails, the entire operation rolls back.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.spotibase_remove_stream_override(
  p_override_id BIGINT
)
RETURNS INT  -- number of days recomputed by cascade
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
  v_days INT;
BEGIN
  -- Get the date before deleting
  SELECT date INTO v_date
  FROM public.track_daily_stream_overrides
  WHERE id = p_override_id;

  IF v_date IS NULL THEN
    RAISE EXCEPTION 'Override with id % not found', p_override_id;
  END IF;

  -- Delete the override
  DELETE FROM public.track_daily_stream_overrides WHERE id = p_override_id;

  -- Cascade recompute from the affected date forward
  SELECT public.spotibase_recompute_playlist_daily_stats_cascade(v_date) INTO v_days;

  RETURN v_days;
END;
$$;

COMMENT ON FUNCTION public.spotibase_remove_stream_override(BIGINT)
IS 'Atomically delete a stream override and cascade-recompute playlist stats from that date forward.';

GRANT EXECUTE ON FUNCTION public.spotibase_remove_stream_override(BIGINT) TO authenticated;

-- ============================================================================
-- PART 3: Clean up overlapping playlist memberships
-- 836 rows have duplicate active memberships (same playlist_key+isrc, both valid_to IS NULL).
-- Keep the row with the earliest valid_from (= when the track first joined).
-- ============================================================================

DELETE FROM public.playlist_memberships
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY playlist_key, isrc
        ORDER BY valid_from ASC, id ASC
      ) AS rn
    FROM public.playlist_memberships
    WHERE valid_to IS NULL
  ) ranked
  WHERE rn > 1
);

-- ============================================================================
-- PART 4: Enable btree_gist + exclusion constraint on playlist_memberships
-- Prevents overlapping time ranges for the same (playlist_key, isrc).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.playlist_memberships
ADD CONSTRAINT playlist_memberships_no_overlap
EXCLUDE USING gist (
  playlist_key WITH =,
  isrc         WITH =,
  daterange(valid_from, COALESCE(valid_to, '9999-12-31'::date), '[]') WITH &&
);

-- ============================================================================
-- PART 5: Foreign key constraints
-- No orphan data exists (verified), so these apply cleanly.
-- Skipping track_daily_streams (large partitioned table) — app-level validation only.
-- ============================================================================

-- Override ISRC must exist in tracks
ALTER TABLE public.track_daily_stream_overrides
ADD CONSTRAINT track_daily_stream_overrides_isrc_fk
FOREIGN KEY (isrc) REFERENCES public.tracks(isrc);

-- Membership playlist_key must exist in playlists
ALTER TABLE public.playlist_memberships
ADD CONSTRAINT playlist_memberships_playlist_key_fk
FOREIGN KEY (playlist_key) REFERENCES public.playlists(playlist_key);

-- Membership ISRC must exist in tracks
ALTER TABLE public.playlist_memberships
ADD CONSTRAINT playlist_memberships_isrc_fk
FOREIGN KEY (isrc) REFERENCES public.tracks(isrc);

-- Stats playlist_key must exist in playlists
ALTER TABLE public.playlist_daily_stats
ADD CONSTRAINT playlist_daily_stats_playlist_key_fk
FOREIGN KEY (playlist_key) REFERENCES public.playlists(playlist_key);

-- ============================================================================
-- PART 6: CHECK constraints
-- ============================================================================

-- Override streams must be non-negative
ALTER TABLE public.track_daily_stream_overrides
ADD CONSTRAINT check_streams_cumulative_override_nonneg
CHECK (streams_cumulative_override >= 0);

-- Membership valid_to must be >= valid_from when set
ALTER TABLE public.playlist_memberships
ADD CONSTRAINT check_valid_range
CHECK (valid_to IS NULL OR valid_from <= valid_to);
