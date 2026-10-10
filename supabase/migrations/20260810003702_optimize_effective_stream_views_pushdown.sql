-- Migration: pushdown-friendly effective stream views (public + competitor)
--
-- The original FULL OUTER JOIN ... USING (date, isrc) formulation prevents Postgres
-- from pushing date/isrc predicates into the partitioned base table: any query that
-- filters the view by a date range without an ISRC list (all the home_* and health_*
-- diagnostics RPCs do exactly that) degrades to scanning/joining the full history and
-- hits statement_timeout (competitor diagnostics after the RPC retrofit; own-catalog
-- health_negative_daily_streams' historic ~1.2s/call cost has the same root cause).
--
-- Rewritten as LEFT JOIN (predicates push into both sides; partition pruning works)
-- plus a small UNION ALL arm for override-only rows (overrides that create a row for
-- a (date, isrc) with no raw snapshot), preserving the exact column shape and the
-- "override wins" semantics.

CREATE OR REPLACE VIEW public.track_daily_streams_effective AS
SELECT
  t.date,
  t.isrc,
  COALESCE(o.streams_cumulative_override, t.streams_cumulative) AS streams_cumulative,
  t.source_run_id,
  t.created_at AS base_created_at,
  (o.id IS NOT NULL) AS is_manual_override,
  o.id AS override_id,
  o.note AS manual_note,
  o.created_at AS manual_created_at,
  o.created_by AS manual_created_by
FROM public.track_daily_streams t
LEFT JOIN public.track_daily_stream_overrides o
  ON o.date = t.date AND o.isrc = t.isrc
UNION ALL
SELECT
  o.date,
  o.isrc,
  o.streams_cumulative_override AS streams_cumulative,
  NULL AS source_run_id,
  NULL AS base_created_at,
  TRUE AS is_manual_override,
  o.id AS override_id,
  o.note AS manual_note,
  o.created_at AS manual_created_at,
  o.created_by AS manual_created_by
FROM public.track_daily_stream_overrides o
WHERE NOT EXISTS (
  SELECT 1 FROM public.track_daily_streams t
  WHERE t.date = o.date AND t.isrc = o.isrc
);

CREATE OR REPLACE VIEW competitor.track_daily_streams_effective AS
SELECT
  t.date,
  t.isrc,
  COALESCE(o.streams_cumulative_override, t.streams_cumulative) AS streams_cumulative,
  t.source_run_id,
  t.created_at AS base_created_at,
  (o.id IS NOT NULL) AS is_manual_override,
  o.id AS override_id,
  o.note AS manual_note,
  o.created_at AS manual_created_at,
  o.created_by AS manual_created_by
FROM competitor.track_daily_streams t
LEFT JOIN competitor.track_daily_stream_overrides o
  ON o.date = t.date AND o.isrc = t.isrc
UNION ALL
SELECT
  o.date,
  o.isrc,
  o.streams_cumulative_override AS streams_cumulative,
  NULL AS source_run_id,
  NULL AS base_created_at,
  TRUE AS is_manual_override,
  o.id AS override_id,
  o.note AS manual_note,
  o.created_at AS manual_created_at,
  o.created_by AS manual_created_by
FROM competitor.track_daily_stream_overrides o
WHERE NOT EXISTS (
  SELECT 1 FROM competitor.track_daily_streams t
  WHERE t.date = o.date AND t.isrc = o.isrc
);

-- public narrow projection keeps the override-created rows (the own-catalog manual
-- override form deliberately fills MISSING snapshot days, so the union arm is load-
-- bearing there).
CREATE OR REPLACE VIEW public.track_daily_streams_effective_public AS
SELECT date, isrc, streams_cumulative
FROM public.track_daily_streams_effective;

-- competitor narrow projection: plain LEFT JOIN with no union arm. A UNION ALL view
-- cannot be flattened by the planner, so RPCs that self-join the view over the full
-- history (home_negative_daily_streams, weekend dips, spikes) degraded from indexed
-- nested loops to timeouts. The auto-interpolator only ever overrides dates that HAVE
-- a raw snapshot row (verified: 0 override-only rows), so dropping the arm is loss-
-- less today. CONSTRAINT: competitor overrides for (date, isrc) pairs with no raw row
-- will NOT surface in dashboards — competitor gap-fill must target existing rows.
CREATE OR REPLACE VIEW competitor.track_daily_streams_effective_public AS
SELECT
  t.date,
  t.isrc,
  COALESCE(o.streams_cumulative_override, t.streams_cumulative) AS streams_cumulative
FROM competitor.track_daily_streams t
LEFT JOIN competitor.track_daily_stream_overrides o
  ON o.date = t.date AND o.isrc = t.isrc;
