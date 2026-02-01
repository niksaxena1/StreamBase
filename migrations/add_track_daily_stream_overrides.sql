-- Migration: Track daily stream overrides (manual fixes)
-- Run this in your Supabase SQL Editor.
--
-- Goal:
-- - Allow admins to manually override/correct per-ISRC cumulative stream snapshots for specific run dates.
-- - Preserve provenance by storing overrides in a separate table (raw snapshots remain untouched).
-- - Provide a "resolved" view that the app/RPCs can use to incorporate overrides.

-- 1) Overrides table (append-only; latest row per (date,isrc) enforced by unique index).
CREATE TABLE IF NOT EXISTS public.track_daily_stream_overrides (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  isrc TEXT NOT NULL,
  streams_cumulative_override BIGINT NOT NULL,
  note TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.track_daily_stream_overrides IS 'Manual per-(date,isrc) overrides for track_daily_streams.streams_cumulative. Raw snapshots remain unchanged; use track_daily_streams_effective for reads.';
COMMENT ON COLUMN public.track_daily_stream_overrides.date IS 'Run date (ingestion snapshot date).';
COMMENT ON COLUMN public.track_daily_stream_overrides.isrc IS 'Track ISRC being overridden.';
COMMENT ON COLUMN public.track_daily_stream_overrides.streams_cumulative_override IS 'Manual cumulative streams snapshot to use for this (date,isrc).';
COMMENT ON COLUMN public.track_daily_stream_overrides.note IS 'Human note explaining why this override was added.';
COMMENT ON COLUMN public.track_daily_stream_overrides.created_by IS 'Supabase auth user id (if provided by UI).';

-- Prevent duplicate overrides for the same (date,isrc).
CREATE UNIQUE INDEX IF NOT EXISTS track_daily_stream_overrides_uq
  ON public.track_daily_stream_overrides (date, isrc);

CREATE INDEX IF NOT EXISTS track_daily_stream_overrides_date_idx
  ON public.track_daily_stream_overrides (date);

CREATE INDEX IF NOT EXISTS track_daily_stream_overrides_isrc_idx
  ON public.track_daily_stream_overrides (isrc);

-- 2) Resolved/effective view.
-- If an override exists for (date,isrc), it wins.
-- This view also surfaces provenance columns so the UI/debugging can show what's manual.
CREATE OR REPLACE VIEW public.track_daily_streams_effective AS
WITH
  base AS (
    SELECT
      date,
      isrc,
      streams_cumulative,
      source_run_id,
      created_at AS base_created_at
    FROM public.track_daily_streams
  ),
  ov AS (
    SELECT
      date,
      isrc,
      streams_cumulative_override,
      note,
      created_by,
      created_at AS override_created_at,
      id AS override_id
    FROM public.track_daily_stream_overrides
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

-- Public (safe) view: exposes only the resolved numeric series.
-- Use this from web/API/RPCs that run as anon/authenticated.
CREATE OR REPLACE VIEW public.track_daily_streams_effective_public AS
SELECT date, isrc, streams_cumulative
FROM public.track_daily_streams_effective;

GRANT SELECT ON public.track_daily_streams_effective_public TO anon, authenticated;

-- 3) Helper RPC: recompute playlist_daily_stats for a run date using the effective streams view.
-- This is useful after manual overrides so playlist totals/deltas reflect the corrected values.
CREATE OR REPLACE FUNCTION public.spotibase_recompute_playlist_daily_stats(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_date DATE := (p_date - INTERVAL '1 day')::date;
BEGIN
  WITH
    run AS (
      SELECT id AS run_id
      FROM public.ingestion_runs
      WHERE run_date = p_date
      LIMIT 1
    ),
    active AS (
      SELECT pm.playlist_key, pm.isrc
      FROM public.playlist_memberships pm
      WHERE pm.valid_from <= p_date
        AND (pm.valid_to IS NULL OR pm.valid_to >= p_date)
    ),
    active_with_all AS (
      SELECT playlist_key, isrc FROM active
      UNION ALL
      SELECT 'all_catalog'::text AS playlist_key, isrc
      FROM active
      WHERE playlist_key IN ('releases', 'ext')
    ),
    dedup AS (
      SELECT playlist_key, isrc
      FROM active_with_all
      GROUP BY playlist_key, isrc
    ),
    prev_totals AS (
      SELECT playlist_key, total_streams_cumulative AS prev_total
      FROM public.playlist_daily_stats
      WHERE date = v_prev_date
    ),
    computed AS (
      SELECT
        p_date AS date,
        d.playlist_key,
        COUNT(*)::int AS track_count,
        COALESCE(SUM(t.streams_cumulative), 0)::bigint AS total_streams_cumulative,
        -- Missing = tracks in membership snapshot without a stream snapshot row.
        COUNT(*) FILTER (WHERE t.streams_cumulative IS NULL)::int AS missing_streams_track_count,
        (COALESCE(SUM(t.streams_cumulative), 0)::bigint - COALESCE(pt.prev_total, 0)::bigint) AS daily_streams_net,
        (COALESCE(SUM(t.streams_cumulative), 0)::numeric * 0.002) AS est_revenue_total,
        ((COALESCE(SUM(t.streams_cumulative), 0)::bigint - COALESCE(pt.prev_total, 0)::bigint)::numeric * 0.002) AS est_revenue_daily_net
      FROM dedup d
      LEFT JOIN public.track_daily_streams_effective t
        ON t.date = p_date AND t.isrc = d.isrc
      LEFT JOIN prev_totals pt
        ON pt.playlist_key = d.playlist_key
      GROUP BY d.playlist_key, pt.prev_total
    )
  INSERT INTO public.playlist_daily_stats (
    date,
    playlist_key,
    track_count,
    total_streams_cumulative,
    daily_streams_net,
    est_revenue_total,
    est_revenue_daily_net,
    missing_streams_track_count,
    source_run_id
  )
  SELECT
    c.date,
    c.playlist_key,
    c.track_count,
    c.total_streams_cumulative,
    c.daily_streams_net,
    c.est_revenue_total,
    c.est_revenue_daily_net,
    c.missing_streams_track_count,
    (SELECT run_id FROM run) AS source_run_id
  FROM computed c
  ON CONFLICT (date, playlist_key) DO UPDATE SET
    track_count = EXCLUDED.track_count,
    total_streams_cumulative = EXCLUDED.total_streams_cumulative,
    daily_streams_net = EXCLUDED.daily_streams_net,
    est_revenue_total = EXCLUDED.est_revenue_total,
    est_revenue_daily_net = EXCLUDED.est_revenue_daily_net,
    missing_streams_track_count = EXCLUDED.missing_streams_track_count,
    source_run_id = EXCLUDED.source_run_id;
END;
$$;

COMMENT ON FUNCTION public.spotibase_recompute_playlist_daily_stats(date) IS 'Recompute playlist_daily_stats for a given run date using track_daily_streams_effective (incorporating manual overrides).';

