-- Indexes on ingestion_warnings for the primary query patterns.
--
-- Pattern 1: WHERE run_date = $1                          (activeWarnings.ts — single-date lookup)
-- Pattern 2: WHERE run_date >= $1 AND severity IN (...)   (health-history — 30-day range)
-- Pattern 3: WHERE run_date = $1 AND code = $2            (future per-code queries)
-- Pattern 4: WHERE run_id = $1                            (ingestion pipeline deletes on re-run)
--
-- All three single-column orderings on run_date are covered by the composite indexes below,
-- so no separate single-column run_date index is needed.

-- Composite: date + severity (health-history range query)
CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_run_date_severity
  ON public.ingestion_warnings (run_date DESC, severity);

-- Composite: date + code (per-code queries, history MV refresh)
CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_run_date_code
  ON public.ingestion_warnings (run_date DESC, code);

-- Covering: run_id (ingestion pipeline delete on re-run)
CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_run_id
  ON public.ingestion_warnings (run_id);

COMMENT ON INDEX public.idx_ingestion_warnings_run_date_severity IS
  'Supports health-history route: WHERE run_date >= $1 AND severity IN (''critical'', ''warn'')';

COMMENT ON INDEX public.idx_ingestion_warnings_run_date_code IS
  'Supports per-code queries and the health_warning_history_mv refresh';

COMMENT ON INDEX public.idx_ingestion_warnings_run_id IS
  'Supports ingestion re-run cleanup: DELETE WHERE run_id = $1';
