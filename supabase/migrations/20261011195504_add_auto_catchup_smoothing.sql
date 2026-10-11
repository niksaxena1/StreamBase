-- Migration: automatic "catch-up smoothing" for daily stream snapshots.
--
-- Problem: SpotOnTrack sometimes delivers stale / partially updated / lagged
-- cumulative counters and then a catch-up day (e.g. 8 & 9 Oct each ~0.6x of a
-- normal day's growth, 10 Oct ~2.2x). Totals are right, the daily shape is not.
--
-- <schema>._catchup_plan(p_end_date, p_lookback_days, p_ignore_note_like)
--   returns the per-track rewrite plan (pure query, no writes).
-- <schema>.spotibase_smooth_catchups(p_end_date, p_lookback_days => 7,
--   p_dry_run => true, p_min_share => 0.20, p_max_share => 0.50,
--   p_ignore_note_like => NULL) applies it per catch-up date.
--
-- Per track, over the window [p_end_date - lookback + 1 .. p_end_date]
-- (effective series = override if present else raw):
--   * baseline = median daily delta over the 14 days before the window; the
--     track is eligible only with >= 7 baseline deltas and baseline >= 20/day.
--   * "low" day: 0 <= delta < 0.75x baseline. "high" day: delta > 1.5x baseline.
--   * A catch-up is a high day H preceded, within 3 days, by a low day with no
--     other high day in between. The window starts at the EARLIEST such low day.
--     The total growth pre..H must be within 0.6x..1.6x of (days) x baseline.
--   * The value before the window and the high day's value are SpotOnTrack
--     anchors and never change. Days between get an even split of the growth.
--     Only raising rewrites are made, so the series stays non-decreasing.
--   * Catalog guards per catch-up date: act only if >= p_min_share of eligible
--     tracks show the pattern (systemic lag); refuse ('mass_guard') above
--     p_max_share of tracks present that day.
--   * Manual fixes always win: a run is skipped when any of its days carries an
--     override whose note is not auto-interp% / auto-catchup%; upserts only
--     replace auto-interp% / auto-catchup% rows. Note: 'auto-catchup:v1 <first>..<high>'.
--
-- Written without temp tables so the whole function is one planned query.
-- Additive: CREATE OR REPLACE only.

-- ---------------------------------------------------------------------------
-- Competitor universe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor._catchup_plan(
  p_end_date date,
  p_lookback_days integer,
  p_ignore_note_like text
)
RETURNS TABLE (
  isrc text, high_d date, first_low date, d date,
  old_cum bigint, new_cum bigint, eligible_total integer, catalog_n integer
)
LANGUAGE sql
STABLE
SET search_path = competitor, public, pg_temp
SET work_mem = '128MB'
AS $fn$
  WITH params AS (
    SELECT p_end_date - (p_lookback_days - 1) AS ws,
           p_end_date - (p_lookback_days - 1) - 14 AS bs
  ), b AS (
    SELECT t.date AS d, t.isrc, t.streams_cumulative AS cum
    FROM competitor.track_daily_streams t, params
    WHERE t.date BETWEEN params.bs - 1 AND p_end_date
  ), o AS (
    SELECT x.date AS d, x.isrc, x.streams_cumulative_override AS cum, x.note
    FROM competitor.track_daily_stream_overrides x, params
    WHERE x.date BETWEEN params.bs - 1 AND p_end_date
      AND (p_ignore_note_like IS NULL OR x.note IS NULL OR x.note NOT LIKE p_ignore_note_like)
  ), v AS (
    SELECT COALESCE(o.d, b.d) AS d, COALESCE(o.isrc, b.isrc) AS isrc,
           COALESCE(o.cum, b.cum) AS cum,
           CASE WHEN o.d IS NOT NULL THEN COALESCE(o.note, '(no note)') END AS note
    FROM b FULL JOIN o ON o.d = b.d AND o.isrc = b.isrc
  ), dl AS MATERIALIZED (
    SELECT v.d, v.isrc, v.cum, v.note,
           CASE WHEN lag(v.d) OVER w = v.d - 1 THEN v.cum - lag(v.cum) OVER w END AS delta
    FROM v
    WINDOW w AS (PARTITION BY v.isrc ORDER BY v.d)
  ), elig AS MATERIALIZED (
    SELECT l.isrc, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) AS med
    FROM dl l, params
    WHERE l.d BETWEEN params.bs AND params.ws - 1 AND l.delta IS NOT NULL
    GROUP BY l.isrc
    HAVING count(*) >= 7
       AND percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) >= 20
  ), g AS (
    SELECT e.isrc, e.med, gs.d::date AS d
    FROM elig e, params
    CROSS JOIN LATERAL generate_series(params.ws - 1, p_end_date, interval '1 day') gs(d)
  ), w AS (
    SELECT g.isrc, g.med, g.d, l.cum, l.note,
           COALESCE(l.delta >= 0 AND l.delta < 0.75 * g.med, false) AS is_low,
           COALESCE(l.delta > 1.5 * g.med, false) AS is_high
    FROM g LEFT JOIN dl l ON l.isrc = g.isrc AND l.d = g.d
  ), r3 AS MATERIALIZED (
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
    CROSS JOIN params
    WHERE h.is_high AND h.d >= params.ws
      AND x.is_low
      AND hm.hc - p.hc = 0
      AND h.cum IS NOT NULL AND p.cum IS NOT NULL
    ORDER BY h.isrc, h.d, k.k DESC
  ), det AS (
    SELECT * FROM det0
    WHERE high_cum - pre_cum BETWEEN 0.6 * (n + 1) * med AND 1.6 * (n + 1) * med
  ), ex AS (
    SELECT det.isrc, det.high_d, det.pre_d, l.d, l.cum AS old_cum, l.note AS old_note,
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
  ), cat AS (
    SELECT l.d, count(*)::integer AS n FROM dl l GROUP BY l.d
  )
  SELECT fl.isrc, fl.high_d, fl.pre_d + 1, fl.d, fl.old_cum, fl.new_cum,
         (SELECT count(*)::integer FROM elig), COALESCE(cat.n, 0)
  FROM fl
  LEFT JOIN cat ON cat.d = fl.high_d
  WHERE fl.ok_notes AND fl.ok_monotone AND fl.changed;
$fn$;

CREATE OR REPLACE FUNCTION competitor.spotibase_smooth_catchups(
  p_end_date date,
  p_lookback_days integer DEFAULT 7,
  p_dry_run boolean DEFAULT true,
  p_min_share numeric DEFAULT 0.20,
  p_max_share numeric DEFAULT 0.50,
  p_ignore_note_like text DEFAULT NULL
)
RETURNS TABLE (
  catchup_date date, tracks_smoothed integer, streams_moved bigint, tracks_eligible integer,
  applied boolean, status text, first_date date, catalog_tracks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public, pg_temp
SET work_mem = '128MB'
SET statement_timeout = '120s'
AS $fn$
#variable_conflict use_column
DECLARE
  v_plan jsonb;
BEGIN
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'p_end_date is required'; END IF;
  IF p_lookback_days IS NULL OR p_lookback_days < 2 OR p_lookback_days > 14 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 2 and 14';
  END IF;
  IF p_ignore_note_like IS NOT NULL AND NOT p_dry_run THEN
    RAISE EXCEPTION 'p_ignore_note_like is a dry-run-only validation switch';
  END IF;

  -- Compute the plan once; reuse it for the summary and the writes.
  SELECT COALESCE(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) INTO v_plan
  FROM competitor._catchup_plan(p_end_date, p_lookback_days, p_ignore_note_like) pl;

  RETURN QUERY
  WITH plan AS (
    SELECT * FROM jsonb_to_recordset(v_plan) AS r(
      isrc text, high_d date, first_low date, d date, old_cum bigint, new_cum bigint,
      eligible_total integer, catalog_n integer)
  ), summary AS (
    SELECT pl.high_d,
           count(DISTINCT pl.isrc)::integer AS tracks_smoothed,
           COALESCE(sum(abs(pl.new_cum - pl.old_cum)), 0)::bigint AS streams_moved,
           min(pl.first_low) AS first_date,
           max(pl.eligible_total) AS eligible,
           max(pl.catalog_n) AS catalog_n
    FROM plan pl GROUP BY pl.high_d
  ), decided AS (
    SELECT s.*,
           CASE
             WHEN s.tracks_smoothed < p_min_share * s.eligible THEN 'below_min_share'
             WHEN s.tracks_smoothed > p_max_share * s.catalog_n THEN 'mass_guard'
             WHEN p_dry_run THEN 'would_apply'
             ELSE 'applied'
           END AS status
    FROM summary s
  ), written AS (
    INSERT INTO competitor.track_daily_stream_overrides AS ov (date, isrc, streams_cumulative_override, note)
    SELECT pl.d, pl.isrc, pl.new_cum, 'auto-catchup:v1 ' || pl.first_low::text || '..' || pl.high_d::text
    FROM plan pl
    JOIN decided dc ON dc.high_d = pl.high_d AND dc.status = 'applied'
    ON CONFLICT (date, isrc) DO UPDATE
      SET streams_cumulative_override = EXCLUDED.streams_cumulative_override,
          note = EXCLUDED.note,
          created_at = now()
      WHERE ov.note LIKE 'auto-interp%' OR ov.note LIKE 'auto-catchup%'
    RETURNING 1
  )
  SELECT dc.high_d, dc.tracks_smoothed, dc.streams_moved, dc.eligible,
         (dc.status = 'applied'), dc.status, dc.first_date, dc.catalog_n
  FROM decided dc
  CROSS JOIN (SELECT count(*) FROM written) w
  ORDER BY dc.high_d;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Own catalog
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._catchup_plan(
  p_end_date date,
  p_lookback_days integer,
  p_ignore_note_like text
)
RETURNS TABLE (
  isrc text, high_d date, first_low date, d date,
  old_cum bigint, new_cum bigint, eligible_total integer, catalog_n integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
SET work_mem = '128MB'
AS $fn$
  WITH params AS (
    SELECT p_end_date - (p_lookback_days - 1) AS ws,
           p_end_date - (p_lookback_days - 1) - 14 AS bs
  ), b AS (
    SELECT t.date AS d, t.isrc, t.streams_cumulative AS cum
    FROM public.track_daily_streams t, params
    WHERE t.date BETWEEN params.bs - 1 AND p_end_date
  ), o AS (
    SELECT x.date AS d, x.isrc, x.streams_cumulative_override AS cum, x.note
    FROM public.track_daily_stream_overrides x, params
    WHERE x.date BETWEEN params.bs - 1 AND p_end_date
      AND (p_ignore_note_like IS NULL OR x.note IS NULL OR x.note NOT LIKE p_ignore_note_like)
  ), v AS (
    SELECT COALESCE(o.d, b.d) AS d, COALESCE(o.isrc, b.isrc) AS isrc,
           COALESCE(o.cum, b.cum) AS cum,
           CASE WHEN o.d IS NOT NULL THEN COALESCE(o.note, '(no note)') END AS note
    FROM b FULL JOIN o ON o.d = b.d AND o.isrc = b.isrc
  ), dl AS MATERIALIZED (
    SELECT v.d, v.isrc, v.cum, v.note,
           CASE WHEN lag(v.d) OVER w = v.d - 1 THEN v.cum - lag(v.cum) OVER w END AS delta
    FROM v
    WINDOW w AS (PARTITION BY v.isrc ORDER BY v.d)
  ), elig AS MATERIALIZED (
    SELECT l.isrc, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) AS med
    FROM dl l, params
    WHERE l.d BETWEEN params.bs AND params.ws - 1 AND l.delta IS NOT NULL
    GROUP BY l.isrc
    HAVING count(*) >= 7
       AND percentile_cont(0.5) WITHIN GROUP (ORDER BY l.delta) >= 20
  ), g AS (
    SELECT e.isrc, e.med, gs.d::date AS d
    FROM elig e, params
    CROSS JOIN LATERAL generate_series(params.ws - 1, p_end_date, interval '1 day') gs(d)
  ), w AS (
    SELECT g.isrc, g.med, g.d, l.cum, l.note,
           COALESCE(l.delta >= 0 AND l.delta < 0.75 * g.med, false) AS is_low,
           COALESCE(l.delta > 1.5 * g.med, false) AS is_high
    FROM g LEFT JOIN dl l ON l.isrc = g.isrc AND l.d = g.d
  ), r3 AS MATERIALIZED (
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
    CROSS JOIN params
    WHERE h.is_high AND h.d >= params.ws
      AND x.is_low
      AND hm.hc - p.hc = 0
      AND h.cum IS NOT NULL AND p.cum IS NOT NULL
    ORDER BY h.isrc, h.d, k.k DESC
  ), det AS (
    SELECT * FROM det0
    WHERE high_cum - pre_cum BETWEEN 0.6 * (n + 1) * med AND 1.6 * (n + 1) * med
  ), ex AS (
    SELECT det.isrc, det.high_d, det.pre_d, l.d, l.cum AS old_cum, l.note AS old_note,
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
  ), cat AS (
    SELECT l.d, count(*)::integer AS n FROM dl l GROUP BY l.d
  )
  SELECT fl.isrc, fl.high_d, fl.pre_d + 1, fl.d, fl.old_cum, fl.new_cum,
         (SELECT count(*)::integer FROM elig), COALESCE(cat.n, 0)
  FROM fl
  LEFT JOIN cat ON cat.d = fl.high_d
  WHERE fl.ok_notes AND fl.ok_monotone AND fl.changed;
$fn$;

CREATE OR REPLACE FUNCTION public.spotibase_smooth_catchups(
  p_end_date date,
  p_lookback_days integer DEFAULT 7,
  p_dry_run boolean DEFAULT true,
  p_min_share numeric DEFAULT 0.20,
  p_max_share numeric DEFAULT 0.50,
  p_ignore_note_like text DEFAULT NULL
)
RETURNS TABLE (
  catchup_date date, tracks_smoothed integer, streams_moved bigint, tracks_eligible integer,
  applied boolean, status text, first_date date, catalog_tracks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET work_mem = '128MB'
SET statement_timeout = '120s'
AS $fn$
#variable_conflict use_column
DECLARE
  v_plan jsonb;
BEGIN
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'p_end_date is required'; END IF;
  IF p_lookback_days IS NULL OR p_lookback_days < 2 OR p_lookback_days > 14 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 2 and 14';
  END IF;
  IF p_ignore_note_like IS NOT NULL AND NOT p_dry_run THEN
    RAISE EXCEPTION 'p_ignore_note_like is a dry-run-only validation switch';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) INTO v_plan
  FROM public._catchup_plan(p_end_date, p_lookback_days, p_ignore_note_like) pl;

  RETURN QUERY
  WITH plan AS (
    SELECT * FROM jsonb_to_recordset(v_plan) AS r(
      isrc text, high_d date, first_low date, d date, old_cum bigint, new_cum bigint,
      eligible_total integer, catalog_n integer)
  ), summary AS (
    SELECT pl.high_d,
           count(DISTINCT pl.isrc)::integer AS tracks_smoothed,
           COALESCE(sum(abs(pl.new_cum - pl.old_cum)), 0)::bigint AS streams_moved,
           min(pl.first_low) AS first_date,
           max(pl.eligible_total) AS eligible,
           max(pl.catalog_n) AS catalog_n
    FROM plan pl GROUP BY pl.high_d
  ), decided AS (
    SELECT s.*,
           CASE
             WHEN s.tracks_smoothed < p_min_share * s.eligible THEN 'below_min_share'
             WHEN s.tracks_smoothed > p_max_share * s.catalog_n THEN 'mass_guard'
             WHEN p_dry_run THEN 'would_apply'
             ELSE 'applied'
           END AS status
    FROM summary s
  ), written AS (
    INSERT INTO public.track_daily_stream_overrides AS ov (date, isrc, streams_cumulative_override, note)
    SELECT pl.d, pl.isrc, pl.new_cum, 'auto-catchup:v1 ' || pl.first_low::text || '..' || pl.high_d::text
    FROM plan pl
    JOIN decided dc ON dc.high_d = pl.high_d AND dc.status = 'applied'
    ON CONFLICT (date, isrc) DO UPDATE
      SET streams_cumulative_override = EXCLUDED.streams_cumulative_override,
          note = EXCLUDED.note,
          created_at = now()
      WHERE ov.note LIKE 'auto-interp%' OR ov.note LIKE 'auto-catchup%'
    RETURNING 1
  )
  SELECT dc.high_d, dc.tracks_smoothed, dc.streams_moved, dc.eligible,
         (dc.status = 'applied'), dc.status, dc.first_date, dc.catalog_n
  FROM decided dc
  CROSS JOIN (SELECT count(*) FROM written) w
  ORDER BY dc.high_d;
END;
$fn$;

COMMENT ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) IS 'Detect SpotOnTrack lag (low days then a catch-up day) and write even-split overrides (note auto-catchup:v1) when systemic. Dry run by default; see migration header for the algorithm and guards.';
COMMENT ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) IS 'Detect SpotOnTrack lag (low days then a catch-up day) and write even-split overrides (note auto-catchup:v1) when systemic. Dry run by default; see migration header for the algorithm and guards.';

REVOKE ALL ON FUNCTION competitor._catchup_plan(date, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._catchup_plan(date, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor._catchup_plan(date, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._catchup_plan(date, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) TO service_role;
