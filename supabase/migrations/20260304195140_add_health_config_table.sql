-- health_config: centralised store for ingestion warning thresholds.
--
-- Previously these lived as hard-coded constants in ingest_exports_to_supabase.py.
-- Moving them here lets you tune thresholds through the health page or a DB client
-- without a code deploy. The ingestion script reads live values at startup and falls
-- back to its module-level defaults when this table is unavailable.
--
-- Only admin users can read/write this table (no RLS row-level per-user rules needed).

CREATE TABLE IF NOT EXISTS public.health_config (
  key          text        PRIMARY KEY,
  value_numeric numeric,
  description  text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.health_config_set_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_health_config_updated_at ON public.health_config;
CREATE TRIGGER trg_health_config_updated_at
  BEFORE UPDATE ON public.health_config
  FOR EACH ROW EXECUTE FUNCTION public.health_config_set_updated_at();

-- RLS: admins only (table has no user-scoped rows)
ALTER TABLE public.health_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage health_config"
  ON public.health_config
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Seed with the defaults currently hard-coded in ingest_exports_to_supabase.py.
-- Use INSERT ... ON CONFLICT DO NOTHING so re-running this migration is safe.
INSERT INTO public.health_config (key, value_numeric, description) VALUES
  (
    'track_count_swing_warn_ratio',
    0.30,
    'Fraction of day-over-day track count change that triggers a track_count_swing warning (default 0.30 = 30%).'
  ),
  (
    'track_count_swing_hard_fail_ratio',
    0.70,
    'Fraction of day-over-day catalog track count change that aborts ingestion entirely (default 0.70 = 70%).'
  ),
  (
    'zero_stream_warn_ratio',
    0.60,
    'Fraction of catalog export rows with 0 cumulative streams that triggers a high_zero_stream_rate warning (default 0.60 = 60%).'
  ),
  (
    'catalog_track_count_drop_critical',
    5,
    'Absolute catalog track count drop per day that triggers a critical track_count_swing warning (default 5).'
  ),
  (
    'stale_source_data_identical_ratio',
    0.90,
    'Fraction of catalog tracks with identical stream totals to yesterday that triggers a stale_source_data warning (default 0.90 = 90%).'
  ),
  (
    'individual_tracks_stale_critical_count',
    15,
    'Number of stale tracks at or above which the individual_tracks_stale warning is escalated to critical severity (default 15).'
  )
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.health_config IS
  'Centralised store for ingestion warning thresholds. Values are read by ingest_exports_to_supabase.py at startup (falls back to hardcoded defaults if unavailable).';
