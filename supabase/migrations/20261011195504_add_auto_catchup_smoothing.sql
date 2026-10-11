-- Migration: automatic "catch-up smoothing" for daily stream snapshots.
--
-- Problem: SpotOnTrack sometimes delivers stale / partially updated / lagged
-- cumulative counters and then a catch-up day (e.g. 8 & 9 Oct each ~0.6x of a
-- normal day's growth, 10 Oct ~2.2x). Totals are right, the daily shape is not.
--
-- <schema>.spotibase_smooth_catchups(p_end_date, p_lookback_days => 7,
--                                    p_dry_run => true, p_min_share => 0.20,
--                                    p_max_share => 0.50, p_ignore_note_like => NULL)
--
-- Per track, over the window [p_end_date - lookback + 1 .. p_end_date]
-- (effective series = override if present else raw):
--   * baseline = median daily delta over the 14 days before the window; the
--     track is eligible only with >= 7 baseline deltas and baseline >= 20/day.
--   * "low" day: 0 <= delta < 0.75x baseline. "high" day: delta > 1.5x baseline.
--   * A catch-up is a high day H preceded, within 3 days, by a low day with no
--     other high day in between. The window starts at the EARLIEST such low day
--     (so "0.6x, 0.6x, 2.2x" and "stale 0x, normal 1x, 2x" are both caught).
--     The total growth pre..H must be within 0.6x..1.6x of (days) x baseline.
--   * The value before the window (pre) and the high day's value are the
--     SpotOnTrack anchors and are never modified. The days between get an even
--     split of the total growth (weekday-weighting was rejected: per-track
--     14-day weekday shapes are too noisy at low volume and an even split is what
--     the manual fixes used). Only raising rewrites are made (never lowers an
--     existing value), so the series stays non-decreasing.
--   * Catalog guards, per catch-up date H: act only if >= p_min_share of the
--     eligible tracks show the pattern on that same date (systemic lag, never
--     isolated noisy tracks); refuse (status 'mass_guard', applied = false) if
--     more than p_max_share of all tracks present that day would change - the
--     ingest scripts raise an ingestion warning 'catchup_needs_review' for it.
--   * Manual fixes always win: a run is skipped when any of its days carries an
--     override whose note is not auto-interp% / auto-catchup%. Rewrites use
--     INSERT .. ON CONFLICT DO UPDATE .. WHERE note LIKE 'auto-interp%' OR
--     'auto-catchup%' as a second line of defence. Note: 'auto-catchup:v1 <first_low>..<high>'.
--   * Dry run (default) computes and returns the summary without writing.
--     p_ignore_note_like (dry run only) treats matching overrides as absent; it
--     exists to replay history ("what would it have done before the manual fix").
--
-- Returns one row per catch-up date: catchup_date, tracks_smoothed,
-- streams_moved (sum of |new - old|), tracks_eligible, applied, status
-- ('applied' | 'would_apply' | 'below_min_share' | 'mass_guard'), first_date
-- (earliest rewritten day, where a playlist-stats cascade must start) and
-- catalog_tracks.
--
-- Own catalog (public) and competitors (competitor) keep separate functions with
-- the same algorithm. Additive: CREATE OR REPLACE only; no table changes.
-- Also: reconcile drops obsolete auto-catchup rows like auto-interp rows
-- (raw now above the smoothed estimate => upstream really corrected it). The
-- own catalog gets a reconcile function that only handles auto-catchup rows.


-- 1) Competitor universe.
CREATE OR REPLACE FUNCTION competitor.spotibase_smooth_catchups(
  p_end_date date,
  p_lookback_days integer DEFAULT 7,
  p_dry_run boolean DEFAULT true,
  p_min_share numeric DEFAULT 0.20,
  p_max_share numeric DEFAULT 0.50,
  p_ignore_note_like text DEFAULT NULL
)
RETURNS TABLE (
  catchup_date date,
  tracks_smoothed integer,
  streams_moved bigint,
  tracks_eligible integer,
  applied boolean,
  status text,
  first_date date,
  catalog_tracks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public, pg_temp
SET work_mem = '128MB'
SET statement_timeout = '120s'
AS $fn$
#variable_conflict use_column
DECLARE
  v_ws date;
  v_bs date;
  v_eligible integer;
BEGIN
  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_end_date is required';
  END IF;
  IF p_lookback_days IS NULL OR p_lookback_days < 2 OR p_lookback_days > 14 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 2 and 14';
  END IF;
  IF p_ignore_note_like IS NOT NULL AND NOT p_dry_run THEN
    RAISE EXCEPTION 'p_ignore_note_like is a dry-run-only validation switch';
  END IF;

  v_ws := p_end_date - (p_lookback_days - 1);  -- first date a run may start on
  v_bs := v_ws - 14;                           -- first baseline delta date

  DROP TABLE IF EXISTS pg_temp._catchup_dl;
  DROP TABLE IF EXISTS pg_temp._catchup_elig;
  DROP TABLE IF EXISTS pg_temp._catchup_cand;
  DROP TABLE IF EXISTS pg_temp._catchup_sum;

  -- Effective series (override wins) with day-over-day deltas. A delta exists
  -- only when the previous calendar day is present, so gaps never fake a delta.
  CREATE TEMP TABLE _catchup_dl ON COMMIT DROP AS
  WITH b AS (
    SELECT t.date AS d, t.isrc, t.streams_cumulative AS cum
    FROM competitor.track_daily_streams t
    WHERE t.date BETWEEN v_bs - 1 AND p_end_date
  ), o AS (
    SELECT x.date AS d, x.isrc, x.streams_cumulative_override AS cum, x.note
    FROM competitor.track_daily_stream_overrides x
    WHERE x.date BETWEEN v_bs - 1 AND p_end_date
      AND (p_ignore_note_like IS NULL OR x.note IS NULL OR x.note NOT LIKE p_ignore_note_like)
  ), v AS (
    SELECT COALESCE(o.d, b.d) AS d, COALESCE(o.isrc, b.isrc) AS isrc,
           COALESCE(o.cum, b.cum) AS cum,
           CASE WHEN o.d IS NOT NULL THEN COALESCE(o.note, '(no note)') END AS note
    FROM b FULL JOIN o ON o.d = b.d AND o.isrc = b.isrc
  )
  SELECT v.d, v.isrc, v.cum, v.note,
         CASE WHEN lag(v.d) OVER w = v.d - 1 THEN v.cum - lag(v.cum) OVER w END AS delta
  FROM v
  WINDOW w AS (PARTITION BY v.isrc ORDER BY v.d);

  -- Eligible tracks: >= 7 baseline deltas and median >= 20 streams/day.
  CREATE TEMP TABLE _catchup_elig ON COMMIT DROP AS
  SELECT l.isrc, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) AS med
  FROM _catchup_dl l
  WHERE l.d BETWEEN v_bs AND v_ws - 1 AND l.delta IS NOT NULL
  GROUP BY l.isrc
  HAVING count(*) >= 7
     AND percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) >= 20;

  SELECT count(*)::integer INTO v_eligible FROM _catchup_elig;

  -- Detect a catch-up: a high day H preceded (within 3 days) by a low day with
  -- no other high day in between. The window is [pre = H-k-1 .. H] where H-k is
  -- the EARLIEST such low day (largest k). The anchors pre and H stay untouched
  -- and the k days between them get an even split of the total growth.
  CREATE TEMP TABLE _catchup_cand ON COMMIT DROP AS
  WITH g AS (
    SELECT e.isrc, e.med, gs.d::date AS d
    FROM _catchup_elig e
    CROSS JOIN generate_series(v_ws - 1, p_end_date, interval '1 day') gs(d)
  ), w AS (
    SELECT g.isrc, g.med, g.d, l.cum, l.note,
           COALESCE(l.delta >= 0 AND l.delta < 0.75 * g.med, false) AS is_low,
           COALESCE(l.delta > 1.5 * g.med, false) AS is_high
    FROM g LEFT JOIN _catchup_dl l ON l.isrc = g.isrc AND l.d = g.d
  ), r3 AS (
    SELECT w.*, sum(w.is_high::int) OVER (PARTITION BY w.isrc ORDER BY w.d) AS hc
    FROM w
  ), det0 AS (
    SELECT DISTINCT ON (h.isrc, h.d)
           h.isrc, h.med, h.d AS high_d, h.cum AS high_cum, k.k AS n,
           p.d AS pre_d, p.cum AS pre_cum
    FROM r3 h
    CROSS JOIN generate_series(1, 3) AS k(k)
    JOIN r3 x ON x.isrc = h.isrc AND x.d = h.d - k.k
    JOIN r3 p ON p.isrc = h.isrc AND p.d = h.d - k.k - 1
    JOIN r3 hm ON hm.isrc = h.isrc AND hm.d = h.d - 1
    WHERE h.is_high AND h.d >= v_ws
      AND x.is_low
      AND hm.hc - p.hc = 0
      AND h.cum IS NOT NULL AND p.cum IS NOT NULL
    ORDER BY h.isrc, h.d, k.k DESC
  ), det AS (
    SELECT * FROM det0
    WHERE high_cum - pre_cum BETWEEN 0.6 * (n + 1) * med AND 1.6 * (n + 1) * med
  ), ex AS (
    SELECT det.isrc, det.high_d, det.pre_d, det.n, det.med, l.d, l.cum AS old_cum, l.note AS old_note,
           det.pre_cum + round((det.high_cum - det.pre_cum)::numeric * (l.d - det.pre_d) / (det.n + 1))::bigint AS new_cum
    FROM det
    JOIN r3 l ON l.isrc = det.isrc AND l.d > det.pre_d AND l.d < det.high_d
  ), fl AS (
    SELECT ex.*,
           bool_and(ex.old_cum IS NOT NULL
                    AND (ex.old_note IS NULL OR ex.old_note LIKE 'auto-interp%' OR ex.old_note LIKE 'auto-catchup%'))
             OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_notes,
           bool_and(ex.new_cum >= ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_monotone,
           bool_or(ex.new_cum <> ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS changed
    FROM ex
  )
  SELECT fl.isrc, fl.high_d, fl.pre_d + 1 AS first_low, fl.n, fl.med, fl.d, fl.old_cum, fl.new_cum, fl.old_note
  FROM fl
  WHERE fl.ok_notes AND fl.ok_monotone AND fl.changed;

  -- Per-date decision: systemic (>= p_min_share of eligible tracks) but not a
  -- mass event (<= p_max_share of all tracks with a value that day).
  CREATE TEMP TABLE _catchup_sum ON COMMIT DROP AS
  WITH per AS (
    SELECT c.high_d, count(DISTINCT c.isrc)::integer AS tracks_smoothed,
           COALESCE(sum(abs(c.new_cum - c.old_cum)) FILTER (WHERE c.new_cum <> c.old_cum), 0)::bigint AS streams_moved,
           min(c.first_low) AS first_date
    FROM _catchup_cand c
    GROUP BY c.high_d
  ), cat AS (
    SELECT l.d, count(*)::integer AS n
    FROM _catchup_dl l
    GROUP BY l.d
  )
  SELECT per.high_d AS catchup_date, per.tracks_smoothed, per.streams_moved, per.first_date,
         COALESCE(cat.n, 0) AS catalog_tracks,
         CASE
           WHEN per.tracks_smoothed < p_min_share * v_eligible THEN 'below_min_share'
           WHEN per.tracks_smoothed > p_max_share * COALESCE(cat.n, 0) THEN 'mass_guard'
           WHEN p_dry_run THEN 'would_apply'
           ELSE 'applied'
         END AS status
  FROM per LEFT JOIN cat ON cat.d = per.high_d;

  IF NOT p_dry_run THEN
    INSERT INTO competitor.track_daily_stream_overrides AS ov (date, isrc, streams_cumulative_override, note)
    SELECT c.d, c.isrc, c.new_cum, 'auto-catchup:v1 ' || c.first_low::text || '..' || c.high_d::text
    FROM _catchup_cand c
    JOIN _catchup_sum s ON s.catchup_date = c.high_d AND s.status = 'applied'
    WHERE c.new_cum <> c.old_cum
    ON CONFLICT (date, isrc) DO UPDATE
      SET streams_cumulative_override = EXCLUDED.streams_cumulative_override,
          note = EXCLUDED.note,
          created_at = now()
      WHERE ov.note LIKE 'auto-interp%' OR ov.note LIKE 'auto-catchup%';
  END IF;

  RETURN QUERY
  SELECT s.catchup_date, s.tracks_smoothed, s.streams_moved, v_eligible,
         (s.status = 'applied'), s.status, s.first_date, s.catalog_tracks
  FROM _catchup_sum s
  ORDER BY s.catchup_date;
END;
$fn$
;

-- 2) Own catalog.
CREATE OR REPLACE FUNCTION public.spotibase_smooth_catchups(
  p_end_date date,
  p_lookback_days integer DEFAULT 7,
  p_dry_run boolean DEFAULT true,
  p_min_share numeric DEFAULT 0.20,
  p_max_share numeric DEFAULT 0.50,
  p_ignore_note_like text DEFAULT NULL
)
RETURNS TABLE (
  catchup_date date,
  tracks_smoothed integer,
  streams_moved bigint,
  tracks_eligible integer,
  applied boolean,
  status text,
  first_date date,
  catalog_tracks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET work_mem = '128MB'
SET statement_timeout = '120s'
AS $fn$
#variable_conflict use_column
DECLARE
  v_ws date;
  v_bs date;
  v_eligible integer;
BEGIN
  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_end_date is required';
  END IF;
  IF p_lookback_days IS NULL OR p_lookback_days < 2 OR p_lookback_days > 14 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 2 and 14';
  END IF;
  IF p_ignore_note_like IS NOT NULL AND NOT p_dry_run THEN
    RAISE EXCEPTION 'p_ignore_note_like is a dry-run-only validation switch';
  END IF;

  v_ws := p_end_date - (p_lookback_days - 1);  -- first date a run may start on
  v_bs := v_ws - 14;                           -- first baseline delta date

  DROP TABLE IF EXISTS pg_temp._catchup_dl;
  DROP TABLE IF EXISTS pg_temp._catchup_elig;
  DROP TABLE IF EXISTS pg_temp._catchup_cand;
  DROP TABLE IF EXISTS pg_temp._catchup_sum;

  -- Effective series (override wins) with day-over-day deltas. A delta exists
  -- only when the previous calendar day is present, so gaps never fake a delta.
  CREATE TEMP TABLE _catchup_dl ON COMMIT DROP AS
  WITH b AS (
    SELECT t.date AS d, t.isrc, t.streams_cumulative AS cum
    FROM public.track_daily_streams t
    WHERE t.date BETWEEN v_bs - 1 AND p_end_date
  ), o AS (
    SELECT x.date AS d, x.isrc, x.streams_cumulative_override AS cum, x.note
    FROM public.track_daily_stream_overrides x
    WHERE x.date BETWEEN v_bs - 1 AND p_end_date
      AND (p_ignore_note_like IS NULL OR x.note IS NULL OR x.note NOT LIKE p_ignore_note_like)
  ), v AS (
    SELECT COALESCE(o.d, b.d) AS d, COALESCE(o.isrc, b.isrc) AS isrc,
           COALESCE(o.cum, b.cum) AS cum,
           CASE WHEN o.d IS NOT NULL THEN COALESCE(o.note, '(no note)') END AS note
    FROM b FULL JOIN o ON o.d = b.d AND o.isrc = b.isrc
  )
  SELECT v.d, v.isrc, v.cum, v.note,
         CASE WHEN lag(v.d) OVER w = v.d - 1 THEN v.cum - lag(v.cum) OVER w END AS delta
  FROM v
  WINDOW w AS (PARTITION BY v.isrc ORDER BY v.d);

  -- Eligible tracks: >= 7 baseline deltas and median >= 20 streams/day.
  CREATE TEMP TABLE _catchup_elig ON COMMIT DROP AS
  SELECT l.isrc, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) AS med
  FROM _catchup_dl l
  WHERE l.d BETWEEN v_bs AND v_ws - 1 AND l.delta IS NOT NULL
  GROUP BY l.isrc
  HAVING count(*) >= 7
     AND percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) >= 20;

  SELECT count(*)::integer INTO v_eligible FROM _catchup_elig;

  -- Detect a catch-up: a high day H preceded (within 3 days) by a low day with
  -- no other high day in between. The window is [pre = H-k-1 .. H] where H-k is
  -- the EARLIEST such low day (largest k). The anchors pre and H stay untouched
  -- and the k days between them get an even split of the total growth.
  CREATE TEMP TABLE _catchup_cand ON COMMIT DROP AS
  WITH g AS (
    SELECT e.isrc, e.med, gs.d::date AS d
    FROM _catchup_elig e
    CROSS JOIN generate_series(v_ws - 1, p_end_date, interval '1 day') gs(d)
  ), w AS (
    SELECT g.isrc, g.med, g.d, l.cum, l.note,
           COALESCE(l.delta >= 0 AND l.delta < 0.75 * g.med, false) AS is_low,
           COALESCE(l.delta > 1.5 * g.med, false) AS is_high
    FROM g LEFT JOIN _catchup_dl l ON l.isrc = g.isrc AND l.d = g.d
  ), r3 AS (
    SELECT w.*, sum(w.is_high::int) OVER (PARTITION BY w.isrc ORDER BY w.d) AS hc
    FROM w
  ), det0 AS (
    SELECT DISTINCT ON (h.isrc, h.d)
           h.isrc, h.med, h.d AS high_d, h.cum AS high_cum, k.k AS n,
           p.d AS pre_d, p.cum AS pre_cum
    FROM r3 h
    CROSS JOIN generate_series(1, 3) AS k(k)
    JOIN r3 x ON x.isrc = h.isrc AND x.d = h.d - k.k
    JOIN r3 p ON p.isrc = h.isrc AND p.d = h.d - k.k - 1
    JOIN r3 hm ON hm.isrc = h.isrc AND hm.d = h.d - 1
    WHERE h.is_high AND h.d >= v_ws
      AND x.is_low
      AND hm.hc - p.hc = 0
      AND h.cum IS NOT NULL AND p.cum IS NOT NULL
    ORDER BY h.isrc, h.d, k.k DESC
  ), det AS (
    SELECT * FROM det0
    WHERE high_cum - pre_cum BETWEEN 0.6 * (n + 1) * med AND 1.6 * (n + 1) * med
  ), ex AS (
    SELECT det.isrc, det.high_d, det.pre_d, det.n, det.med, l.d, l.cum AS old_cum, l.note AS old_note,
           det.pre_cum + round((det.high_cum - det.pre_cum)::numeric * (l.d - det.pre_d) / (det.n + 1))::bigint AS new_cum
    FROM det
    JOIN r3 l ON l.isrc = det.isrc AND l.d > det.pre_d AND l.d < det.high_d
  ), fl AS (
    SELECT ex.*,
           bool_and(ex.old_cum IS NOT NULL
                    AND (ex.old_note IS NULL OR ex.old_note LIKE 'auto-interp%' OR ex.old_note LIKE 'auto-catchup%'))
             OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_notes,
           bool_and(ex.new_cum >= ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_monotone,
           bool_or(ex.new_cum <> ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS changed
    FROM ex
  )
  SELECT fl.isrc, fl.high_d, fl.pre_d + 1 AS first_low, fl.n, fl.med, fl.d, fl.old_cum, fl.new_cum, fl.old_note
  FROM fl
  WHERE fl.ok_notes AND fl.ok_monotone AND fl.changed;

  -- Per-date decision: systemic (>= p_min_share of eligible tracks) but not a
  -- mass event (<= p_max_share of all tracks with a value that day).
  CREATE TEMP TABLE _catchup_sum ON COMMIT DROP AS
  WITH per AS (
    SELECT c.high_d, count(DISTINCT c.isrc)::integer AS tracks_smoothed,
           COALESCE(sum(abs(c.new_cum - c.old_cum)) FILTER (WHERE c.new_cum <> c.old_cum), 0)::bigint AS streams_moved,
           min(c.first_low) AS first_date
    FROM _catchup_cand c
    GROUP BY c.high_d
  ), cat AS (
    SELECT l.d, count(*)::integer AS n
    FROM _catchup_dl l
    GROUP BY l.d
  )
  SELECT per.high_d AS catchup_date, per.tracks_smoothed, per.streams_moved, per.first_date,
         COALESCE(cat.n, 0) AS catalog_tracks,
         CASE
           WHEN per.tracks_smoothed < p_min_share * v_eligible THEN 'below_min_share'
           WHEN per.tracks_smoothed > p_max_share * COALESCE(cat.n, 0) THEN 'mass_guard'
           WHEN p_dry_run THEN 'would_apply'
           ELSE 'applied'
         END AS status
  FROM per LEFT JOIN cat ON cat.d = per.high_d;

  IF NOT p_dry_run THEN
    INSERT INTO public.track_daily_stream_overrides AS ov (date, isrc, streams_cumulative_override, note)
    SELECT c.d, c.isrc, c.new_cum, 'auto-catchup:v1 ' || c.first_low::text || '..' || c.high_d::text
    FROM _catchup_cand c
    JOIN _catchup_sum s ON s.catchup_date = c.high_d AND s.status = 'applied'
    WHERE c.new_cum <> c.old_cum
    ON CONFLICT (date, isrc) DO UPDATE
      SET streams_cumulative_override = EXCLUDED.streams_cumulative_override,
          note = EXCLUDED.note,
          created_at = now()
      WHERE ov.note LIKE 'auto-interp%' OR ov.note LIKE 'auto-catchup%';
  END IF;

  RETURN QUERY
  SELECT s.catchup_date, s.tracks_smoothed, s.streams_moved, v_eligible,
         (s.status = 'applied'), s.status, s.first_date, s.catalog_tracks
  FROM _catchup_sum s
  ORDER BY s.catchup_date;
END;
$fn$
;

COMMENT ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) IS 'Detect SpotOnTrack lag (low days then a catch-up day) and write even-split overrides (note auto-catchup:v1) when systemic. Dry run by default; see migration header for the algorithm and guards.';

REVOKE ALL ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) TO service_role;

COMMENT ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) IS 'Detect SpotOnTrack lag (low days then a catch-up day) and write even-split overrides (note auto-catchup:v1) when systemic. Dry run by default; see migration header for the algorithm and guards.';

REVOKE ALL ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) TO service_role;

-- 3) Reconcile: auto-catchup rows are obsolete (and dropped) when raw is now above them.
-- Smoothing only ever raises values, so raw > override can only mean upstream
-- backfilled the lagged days. Identical to the live competitor definition apart
-- from the added 'auto-catchup%' note prefix.
CREATE OR REPLACE FUNCTION competitor.spotibase_reconcile_auto_overrides(
  p_start_date date DEFAULT (CURRENT_DATE - 45),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'competitor', 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  WITH deleted AS (
    DELETE FROM competitor.track_daily_stream_overrides o
    USING competitor.track_daily_streams t
    WHERE t.date = o.date
      AND t.isrc = o.isrc
      AND (o.note LIKE 'auto-interp%' OR o.note LIKE 'auto-catchup%')
      AND o.date BETWEEN p_start_date AND p_end_date
      AND t.streams_cumulative > o.streams_cumulative_override
    RETURNING o.id
  )
  SELECT COUNT(*)::int INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$function$;

-- Own catalog has no auto-interp machinery; this variant only reconciles auto-catchup rows.
CREATE OR REPLACE FUNCTION public.spotibase_reconcile_auto_overrides(
  p_start_date date DEFAULT (CURRENT_DATE - 45),
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  WITH deleted AS (
    DELETE FROM public.track_daily_stream_overrides o
    USING public.track_daily_streams t
    WHERE t.date = o.date
      AND t.isrc = o.isrc
      AND o.note LIKE 'auto-catchup%'
      AND o.date BETWEEN p_start_date AND p_end_date
      AND t.streams_cumulative > o.streams_cumulative_override
    RETURNING o.id
  )
  SELECT COUNT(*)::int INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.spotibase_reconcile_auto_overrides(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spotibase_reconcile_auto_overrides(date, date) TO service_role;
