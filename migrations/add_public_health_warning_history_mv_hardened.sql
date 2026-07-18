-- Applied to prod 2026-07-18 via Supabase MCP (migration name:
-- add_public_health_warning_history_mv_hardened).
--
-- Public-schema twin of competitor.health_warning_history_mv. The repo has
-- shipped migrations/add_health_warning_history_mv.sql (and the ingestion
-- script has called the refresh function nightly) but it was never applied to
-- prod; /api/health-history had been using its slow raw-table fallback and the
-- nightly refresh logged a swallowed warning. This version additionally pins
-- search_path and locks execute to service_role, matching
-- security_hardening_revoke_anon_execute_and_rls.sql conventions.
-- Supersedes add_health_warning_history_mv.sql.

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

CREATE OR REPLACE FUNCTION public.refresh_health_warning_history_mv()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.health_warning_history_mv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_health_warning_history_mv() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_health_warning_history_mv() TO service_role;

REVOKE ALL ON public.health_warning_history_mv FROM anon;
GRANT SELECT ON public.health_warning_history_mv TO authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.health_warning_history_mv IS
  'Pre-aggregated warning counts by (run_date, code, severity). Refresh via refresh_health_warning_history_mv() after each ingestion run.';

COMMENT ON FUNCTION public.refresh_health_warning_history_mv() IS
  'Refreshes health_warning_history_mv concurrently. Called by the ingestion script after a successful run.';
