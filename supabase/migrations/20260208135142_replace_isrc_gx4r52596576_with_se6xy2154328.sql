-- Migration: Replace wrong ISRC GX4R52596576 with correct ISRC SE6XY2154328
--
-- A track was distributed with the wrong ISRC (GX4R52596576).
-- This migration re-attributes all data from the wrong ISRC to the correct one
-- (SE6XY2154328) across every table that stores ISRC values.
--
-- Strategy:
--   1. Temporarily drop FK and exclusion constraints that would block the rename.
--   2. For each child table: UPDATE rows to the new ISRC where no conflict exists,
--      then DELETE any remaining old-ISRC rows (duplicate dates/keys already covered
--      by the correct ISRC).
--   3. Merge or rename the tracks row (parent PK).
--   4. Re-add all dropped constraints.
--
-- The entire script runs inside a single transaction (Supabase SQL Editor default).
-- If anything fails, the whole migration rolls back.

-- ============================================================================
-- STEP 1: Drop FK and exclusion constraints
-- ============================================================================

ALTER TABLE public.track_daily_stream_overrides
  DROP CONSTRAINT IF EXISTS track_daily_stream_overrides_isrc_fk;

ALTER TABLE public.playlist_memberships
  DROP CONSTRAINT IF EXISTS playlist_memberships_isrc_fk;

ALTER TABLE public.playlist_memberships
  DROP CONSTRAINT IF EXISTS playlist_memberships_no_overlap;

-- ============================================================================
-- STEP 2: track_daily_streams  (partitioned, no FK)
-- Update rows where the correct ISRC doesn't already have data for that date.
-- Delete any remaining old-ISRC rows (those dates are already covered).
-- ============================================================================

UPDATE public.track_daily_streams
SET    isrc = 'SE6XY2154328'
WHERE  isrc = 'GX4R52596576'
  AND  NOT EXISTS (
         SELECT 1 FROM public.track_daily_streams t2
         WHERE  t2.isrc = 'SE6XY2154328'
           AND  t2.date = track_daily_streams.date
       );

DELETE FROM public.track_daily_streams
WHERE  isrc = 'GX4R52596576';

-- ============================================================================
-- STEP 3: track_daily_stream_overrides
-- Same approach: update where safe, delete remaining duplicates.
-- ============================================================================

UPDATE public.track_daily_stream_overrides
SET    isrc = 'SE6XY2154328'
WHERE  isrc = 'GX4R52596576'
  AND  NOT EXISTS (
         SELECT 1 FROM public.track_daily_stream_overrides t2
         WHERE  t2.isrc = 'SE6XY2154328'
           AND  t2.date = track_daily_stream_overrides.date
       );

DELETE FROM public.track_daily_stream_overrides
WHERE  isrc = 'GX4R52596576';

-- ============================================================================
-- STEP 4: playlist_memberships
-- Update where no conflict on (playlist_key, isrc, valid_from).
-- Delete remaining old-ISRC rows.
-- ============================================================================

UPDATE public.playlist_memberships
SET    isrc = 'SE6XY2154328'
WHERE  isrc = 'GX4R52596576'
  AND  NOT EXISTS (
         SELECT 1 FROM public.playlist_memberships pm2
         WHERE  pm2.isrc         = 'SE6XY2154328'
           AND  pm2.playlist_key = playlist_memberships.playlist_key
           AND  pm2.valid_from   = playlist_memberships.valid_from
       );

DELETE FROM public.playlist_memberships
WHERE  isrc = 'GX4R52596576';

-- ============================================================================
-- STEP 5: health_warning_exclusions
-- Update where no conflict on (code, playlist_key, isrc).
-- Delete remaining old-ISRC rows.
-- ============================================================================

UPDATE public.health_warning_exclusions
SET    isrc = 'SE6XY2154328'
WHERE  isrc = 'GX4R52596576'
  AND  NOT EXISTS (
         SELECT 1 FROM public.health_warning_exclusions h2
         WHERE  h2.isrc         = 'SE6XY2154328'
           AND  h2.code         = health_warning_exclusions.code
           AND  COALESCE(h2.playlist_key, '') = COALESCE(health_warning_exclusions.playlist_key, '')
       );

DELETE FROM public.health_warning_exclusions
WHERE  isrc = 'GX4R52596576';

-- ============================================================================
-- STEP 6: tracks  (parent table, PK = isrc)
-- If SE6XY2154328 already exists: merge first_seen/last_seen, then delete old.
-- If it doesn't exist: simply rename the old row.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tracks WHERE isrc = 'SE6XY2154328') THEN
    -- Correct ISRC already exists; keep it but widen the seen window
    UPDATE public.tracks
    SET    first_seen = LEAST(
             first_seen,
             (SELECT first_seen FROM public.tracks WHERE isrc = 'GX4R52596576')
           ),
           last_seen  = GREATEST(
             last_seen,
             (SELECT last_seen FROM public.tracks WHERE isrc = 'GX4R52596576')
           )
    WHERE  isrc = 'SE6XY2154328'
      AND  EXISTS (SELECT 1 FROM public.tracks WHERE isrc = 'GX4R52596576');

    DELETE FROM public.tracks WHERE isrc = 'GX4R52596576';
  ELSE
    -- Correct ISRC doesn't exist yet; just rename
    UPDATE public.tracks
    SET    isrc = 'SE6XY2154328'
    WHERE  isrc = 'GX4R52596576';
  END IF;
END $$;

-- ============================================================================
-- STEP 6b: Clean up overlapping playlist memberships for the new ISRC
-- After merging, the new ISRC may have rows with overlapping date ranges
-- in the same playlist (e.g. an open-ended row and a closed row that falls
-- within it). For each overlapping pair, keep the earlier row (by valid_from,
-- then by id) and delete the later one.
-- ============================================================================

DELETE FROM public.playlist_memberships pm_del
WHERE  isrc = 'SE6XY2154328'
  AND  EXISTS (
         SELECT 1 FROM public.playlist_memberships pm_keep
         WHERE  pm_keep.isrc         = 'SE6XY2154328'
           AND  pm_keep.playlist_key = pm_del.playlist_key
           AND  pm_keep.id          != pm_del.id
           AND  daterange(pm_keep.valid_from, COALESCE(pm_keep.valid_to, '9999-12-31'::date), '[]')
                && daterange(pm_del.valid_from, COALESCE(pm_del.valid_to, '9999-12-31'::date), '[]')
           AND  (pm_keep.valid_from < pm_del.valid_from
                 OR (pm_keep.valid_from = pm_del.valid_from AND pm_keep.id < pm_del.id))
       );

-- ============================================================================
-- STEP 7: Re-add FK and exclusion constraints
-- ============================================================================

ALTER TABLE public.track_daily_stream_overrides
  ADD CONSTRAINT track_daily_stream_overrides_isrc_fk
  FOREIGN KEY (isrc) REFERENCES public.tracks(isrc);

ALTER TABLE public.playlist_memberships
  ADD CONSTRAINT playlist_memberships_isrc_fk
  FOREIGN KEY (isrc) REFERENCES public.tracks(isrc);

ALTER TABLE public.playlist_memberships
  ADD CONSTRAINT playlist_memberships_no_overlap
  EXCLUDE USING gist (
    playlist_key WITH =,
    isrc         WITH =,
    daterange(valid_from, COALESCE(valid_to, '9999-12-31'::date), '[]') WITH &&
  );

-- ============================================================================
-- STEP 8: Verify — no trace of the old ISRC should remain
-- ============================================================================

DO $$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.tracks WHERE isrc = 'GX4R52596576';
  ASSERT v_count = 0, 'tracks still has old ISRC';

  SELECT COUNT(*) INTO v_count FROM public.track_daily_streams WHERE isrc = 'GX4R52596576';
  ASSERT v_count = 0, 'track_daily_streams still has old ISRC';

  SELECT COUNT(*) INTO v_count FROM public.track_daily_stream_overrides WHERE isrc = 'GX4R52596576';
  ASSERT v_count = 0, 'track_daily_stream_overrides still has old ISRC';

  SELECT COUNT(*) INTO v_count FROM public.playlist_memberships WHERE isrc = 'GX4R52596576';
  ASSERT v_count = 0, 'playlist_memberships still has old ISRC';

  SELECT COUNT(*) INTO v_count FROM public.health_warning_exclusions WHERE isrc = 'GX4R52596576';
  ASSERT v_count = 0, 'health_warning_exclusions still has old ISRC';

  RAISE NOTICE 'ISRC replacement verified — GX4R52596576 fully replaced with SE6XY2154328';
END $$;
