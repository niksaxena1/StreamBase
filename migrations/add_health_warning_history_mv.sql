-- Materialized view: health_warning_history_mv
--
-- Pre-aggregates ingestion_warnings by (run_date, code, severity) so the
-- /api/health-history endpoint can return 30-day warning-count data with a
-- single indexed scan instead of scanning + grouping the raw table each time.
--
-- Refresh strategy:
--   • Call refresh_health_warning_history_mv() after each successful ingestion run.
--     The ingestion script (ingest_exports_to_supabase.py) does this automatically.
--   • The CONCURRENTLY option means reads are never blocked during refresh.
--   • The unique index on (run_date, code, severity) is required for CONCURRENTLY.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.health_warning_history_mv AS
SELECT
  run_date,
  code,
  severity,
  count(*) AS warning_count
FROM public.ingestion_warnings
WHERE severity IN ('critical', 'warn')
GROUP BY run_date, code, severity
WITH DATA;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_warning_history_mv_pk
  ON public.health_warning_history_mv (run_date, code, severity);

-- Supporting index for the history route's date-range filter
CREATE INDEX IF NOT EXISTS idx_health_warning_history_mv_run_date
  ON public.health_warning_history_mv (run_date DESC);

-- Refresh function (called by the ingestion script and the refresh button)
CREATE OR REPLACE FUNCTION public.refresh_health_warning_history_mv()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.health_warning_history_mv;
END;
$$;

COMMENT ON MATERIALIZED VIEW public.health_warning_history_mv IS
  'Pre-aggregated warning counts by (run_date, code, severity). Refresh via refresh_health_warning_history_mv() after each ingestion run.';

COMMENT ON FUNCTION public.refresh_health_warning_history_mv() IS
  'Refreshes health_warning_history_mv concurrently. Called by the ingestion script after a successful run.';
