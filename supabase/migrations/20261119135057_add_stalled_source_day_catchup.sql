-- Migration: catch-up smoothing for stalled source days (own catalog).
--
-- Problem: the lag rule in 20261011195504_add_auto_catchup_smoothing.sql only acts
-- when the catch-up day is > 1.5x a track's normal day. When SpotOnTrack / Spotify
-- does not update at all for one or more days and the stall falls on weekly-low
-- days, the catch-up day carries (k + 1) days of growth but is still < 1.5x normal
-- (10 Nov and 17 Nov 2026: ~1.3x), so most tracks were left with a 0 day followed
-- by a double day and had to be fixed by hand.
--
-- public._stall_plan(p_end_date, p_lookback_days, p_stall_share, p_ignore_note_like)
--   pure query, no writes. Over raw public.track_daily_streams:
--   * "active" track: >= 7 daily deltas in the read range averaging >= 5 streams/day.
--   * "stalled day": >= 50 active tracks present and >= p_stall_share of them have a
--     raw delta of exactly 0 (normal days: <= ~6%; real stalls: 93-100%).
--   * A stall run is a set of CONSECUTIVE stalled days D1..Dk (k >= 1, so several
--     missed days in a row are one event). Its catch-up day H = Dk + 1 must have
--     data, must not itself be stalled, and must fall in the lookback window. A run
--     that is still open (H not ingested yet) is left alone until H arrives.
--   * Per track (any size, no baseline needed): the raw counter is identical on
--     every day from D1 - 1 through Dk, and the effective value at H is higher than
--     at D1 - 1. Those two values are anchors and never change; D1..Dk get an even
--     split: pre + growth * i / (k + 1).
--   * Manual fixes always win: a track is skipped when any of D1..Dk carries an
--     override whose note is not auto-interp% / auto-catchup%. Only raising rewrites.
--
-- public.spotibase_smooth_catchups keeps its signature and return type. It now:
--   * decides the lag rule exactly as before;
--   * adds stall rows for tracks the lag rule did not handle for the same catch-up
--     day (the lag rule wins where it applied, it may reach back further);
--   * reports the stall as its own row: status 'applied_stall' / 'would_apply_stall';
--   * reports a lag-rule 'mass_guard' as 'covered_by_stall' when the stall rule
--     handled that day (a full stall on a normal-volume day trips the mass guard,
--     which would otherwise raise a needless catchup_needs_review warning).
--   Note written: 'auto-catchup:v1 <D1>..<H> even-split (source flat <D1>[..<Dk>])'.
--
--   * Tracks whose stalled days all already carry a lag-rule override are left alone.
--
-- Own catalog only. Additive: CREATE OR REPLACE only.
-- Applied live in two steps (add_stalled_source_day_catchup, then
-- add_stalled_source_day_catchup_v2 for the lag_handled skip); this file is the final state.

CREATE OR REPLACE FUNCTION public._stall_plan(
  p_end_date date,
  p_lookback_days integer,
  p_stall_share numeric,
  p_ignore_note_like text
)
RETURNS TABLE (
  isrc text, high_d date, first_flat date, last_flat date, d date,
  old_cum bigint, new_cum bigint, active_n integer, flat_n integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
SET work_mem = '128MB'
AS $fn$
  WITH params AS (
    SELECT p_end_date - (p_lookback_days - 1) AS ws,
           p_end_date - (p_lookback_days - 1) - 14 AS bs
  ), b AS MATERIALIZED (
    SELECT t.date AS d, t.isrc, t.streams_cumulative AS cum,
           CASE WHEN lag(t.date) OVER w = t.date - 1
                THEN t.streams_cumulative - lag(t.streams_cumulative) OVER w END AS delta
    FROM public.track_daily_streams t, params
    WHERE t.date BETWEEN params.bs - 1 AND p_end_date
    WINDOW w AS (PARTITION BY t.isrc ORDER BY t.date)
  ), act AS MATERIALIZED (
    SELECT b.isrc
    FROM b
    WHERE b.delta IS NOT NULL
    GROUP BY b.isrc
    HAVING count(*) >= 7 AND sum(b.delta) >= 5 * count(*)
  ), days AS MATERIALIZED (
    SELECT b.d, count(*)::integer AS active_n,
           (count(*) FILTER (WHERE b.delta = 0))::integer AS flat_n
    FROM b JOIN act a ON a.isrc = b.isrc
    WHERE b.delta IS NOT NULL
    GROUP BY b.d
  ), stalled AS (
    SELECT s.d, s.active_n, s.flat_n,
           s.d - (row_number() OVER (ORDER BY s.d))::integer AS grp
    FROM days s
    WHERE s.active_n >= 50 AND s.flat_n >= p_stall_share * s.active_n
  ), runs AS (
    SELECT min(s.d) AS first_flat, max(s.d) AS last_flat,
           max(s.d) + 1 AS high_d, min(s.d) - 1 AS pre_d,
           (max(s.d) - min(s.d) + 1)::integer AS k,
           max(s.active_n) AS active_n, min(s.flat_n) AS flat_n
    FROM stalled s
    GROUP BY s.grp
  ), runs_ok AS (
    SELECT r.*
    FROM runs r, params
    WHERE r.high_d BETWEEN params.ws AND p_end_date
      AND r.pre_d >= params.bs - 1
      AND EXISTS (SELECT 1 FROM days x WHERE x.d = r.high_d)
  ), flat AS (
    SELECT r.high_d, r.first_flat, r.last_flat, r.pre_d, r.k, r.active_n, r.flat_n, b.isrc
    FROM runs_ok r
    JOIN b ON b.d BETWEEN r.pre_d AND r.last_flat
    GROUP BY r.high_d, r.first_flat, r.last_flat, r.pre_d, r.k, r.active_n, r.flat_n, b.isrc
    HAVING count(*) = r.k + 1 AND min(b.cum) = max(b.cum)
  ), o AS (
    SELECT x.date AS d, x.isrc, x.streams_cumulative_override AS cum,
           COALESCE(x.note, '(no note)') AS note
    FROM public.track_daily_stream_overrides x, params
    WHERE x.date BETWEEN params.bs - 1 AND p_end_date
      AND (p_ignore_note_like IS NULL OR x.note IS NULL OR x.note NOT LIKE p_ignore_note_like)
  ), eff AS (
    SELECT b.d, b.isrc, COALESCE(o.cum, b.cum) AS cum, o.note
    FROM b LEFT JOIN o ON o.d = b.d AND o.isrc = b.isrc
  ), anchored AS (
    SELECT f.*, pre.cum AS pre_cum, hi.cum AS high_cum
    FROM flat f
    JOIN eff pre ON pre.isrc = f.isrc AND pre.d = f.pre_d
    JOIN eff hi ON hi.isrc = f.isrc AND hi.d = f.high_d
    WHERE hi.cum > pre.cum
  ), ex AS (
    SELECT a.isrc, a.high_d, a.first_flat, a.last_flat, a.active_n, a.flat_n,
           e.d, e.cum AS old_cum, e.note AS old_note,
           a.pre_cum + round((a.high_cum - a.pre_cum)::numeric * (e.d - a.pre_d) / (a.k + 1))::bigint AS new_cum
    FROM anchored a
    JOIN eff e ON e.isrc = a.isrc AND e.d BETWEEN a.first_flat AND a.last_flat
  ), fl AS (
    SELECT ex.*,
           bool_and(ex.old_note IS NULL OR ex.old_note LIKE 'auto-interp%' OR ex.old_note LIKE 'auto-catchup%')
             OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_notes,
           bool_and(ex.new_cum >= ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS ok_monotone,
           bool_or(ex.new_cum <> ex.old_cum) OVER (PARTITION BY ex.isrc, ex.high_d) AS changed,
           -- Every stalled day already carries a lag-rule override: leave it (re-splitting
           -- from an already smoothed anchor only produces 1-stream rounding churn).
           bool_and(ex.old_note IS NOT NULL AND ex.old_note NOT LIKE '%source flat%')
             OVER (PARTITION BY ex.isrc, ex.high_d) AS lag_handled
    FROM ex
  )
  SELECT fl.isrc, fl.high_d, fl.first_flat, fl.last_flat, fl.d, fl.old_cum, fl.new_cum,
         fl.active_n, fl.flat_n
  FROM fl
  WHERE fl.ok_notes AND fl.ok_monotone AND fl.changed AND NOT fl.lag_handled;
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
  c_stall_share CONSTANT numeric := 0.50;
  v_plan jsonb;
  v_stall jsonb;
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

  SELECT COALESCE(jsonb_agg(to_jsonb(sp)), '[]'::jsonb) INTO v_stall
  FROM public._stall_plan(p_end_date, p_lookback_days, c_stall_share, p_ignore_note_like) sp;

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
  ), stall_all AS (
    SELECT * FROM jsonb_to_recordset(v_stall) AS r(
      isrc text, high_d date, first_flat date, last_flat date, d date,
      old_cum bigint, new_cum bigint, active_n integer, flat_n integer)
  ), stall AS (
    -- The lag rule wins for the tracks it handles for the same catch-up day.
    SELECT sa.*
    FROM stall_all sa
    WHERE NOT EXISTS (
      SELECT 1
      FROM plan pl
      JOIN decided dc ON dc.high_d = pl.high_d AND dc.status IN ('applied', 'would_apply')
      WHERE pl.isrc = sa.isrc AND pl.high_d = sa.high_d
    )
  ), stall_summary AS (
    SELECT st.high_d,
           count(DISTINCT st.isrc)::integer AS tracks_smoothed,
           COALESCE(sum(abs(st.new_cum - st.old_cum)), 0)::bigint AS streams_moved,
           min(st.first_flat) AS first_date,
           max(st.active_n) AS eligible,
           max(st.active_n) AS catalog_n
    FROM stall st GROUP BY st.high_d
  ), to_write AS (
    SELECT DISTINCT ON (u.d, u.isrc) u.d, u.isrc, u.new_cum, u.note
    FROM (
      SELECT pl.d, pl.isrc, pl.new_cum,
             'auto-catchup:v1 ' || pl.first_low::text || '..' || pl.high_d::text AS note,
             0 AS prio
      FROM plan pl
      JOIN decided dc ON dc.high_d = pl.high_d AND dc.status = 'applied'
      UNION ALL
      SELECT st.d, st.isrc, st.new_cum,
             'auto-catchup:v1 ' || st.first_flat::text || '..' || st.high_d::text
               || ' even-split (source flat ' || st.first_flat::text
               || CASE WHEN st.last_flat > st.first_flat THEN '..' || st.last_flat::text ELSE '' END
               || ')' AS note,
             1 AS prio
      FROM stall st
      WHERE NOT p_dry_run
    ) u
    ORDER BY u.d, u.isrc, u.prio
  ), written AS (
    INSERT INTO public.track_daily_stream_overrides AS ov (date, isrc, streams_cumulative_override, note)
    SELECT tw.d, tw.isrc, tw.new_cum, tw.note
    FROM to_write tw
    ON CONFLICT (date, isrc) DO UPDATE
      SET streams_cumulative_override = EXCLUDED.streams_cumulative_override,
          note = EXCLUDED.note,
          created_at = now()
      WHERE ov.note LIKE 'auto-interp%' OR ov.note LIKE 'auto-catchup%'
    RETURNING 1
  ), out_rows AS (
    SELECT dc.high_d, dc.tracks_smoothed, dc.streams_moved, dc.eligible,
           (dc.status = 'applied') AS applied,
           CASE WHEN dc.status = 'mass_guard'
                     AND EXISTS (SELECT 1 FROM stall_summary ss WHERE ss.high_d = dc.high_d)
                THEN 'covered_by_stall' ELSE dc.status END AS status,
           dc.first_date, dc.catalog_n, 0 AS ord
    FROM decided dc
    UNION ALL
    SELECT ss.high_d, ss.tracks_smoothed, ss.streams_moved, ss.eligible,
           (NOT p_dry_run),
           CASE WHEN p_dry_run THEN 'would_apply_stall' ELSE 'applied_stall' END,
           ss.first_date, ss.catalog_n, 1
    FROM stall_summary ss
  )
  SELECT r.high_d, r.tracks_smoothed, r.streams_moved, r.eligible,
         r.applied, r.status, r.first_date, r.catalog_n
  FROM out_rows r
  CROSS JOIN (SELECT count(*) FROM written) w
  ORDER BY r.high_d, r.ord;
END;
$fn$;

COMMENT ON FUNCTION public.spotibase_smooth_catchups(date, integer, boolean, numeric, numeric, text) IS 'Detect SpotOnTrack lag (low days then a catch-up day) and fully stalled source days (one or more consecutive days with no counter updates), and write even-split overrides (note auto-catchup:v1). Dry run by default; see migrations 20261011195504 and 20261119135057 for the rules and guards.';

REVOKE ALL ON FUNCTION public._stall_plan(date, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._stall_plan(date, integer, numeric, text) TO service_role;
