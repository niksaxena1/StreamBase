-- Applied to prod 2026-08-14 via Supabase MCP (migration name:
-- stream_payout_rate_from_health_config).
--
-- Single source of truth for the ingest-time estimated-revenue rate.
--
-- The rate ($/stream) was hardcoded as 0.002 in four places: both recompute
-- functions (public + competitor) and both Python ingest scripts. It now lives
-- in health_config under `stream_payout_usd_per_stream` and is read through
-- public.spotibase_stream_payout_rate(). Python reads the same key via
-- scripts/streambase_rate.py.
--
-- Two different rates exist by design:
--   * GLOBAL  health_config.stream_payout_usd_per_stream  → precomputed
--     playlist_daily_stats.est_revenue_* columns (this migration).
--   * PER-USER user_settings.stream_payout_rate_per_k_usd → everything the web
--     app displays (Settings page). The app derives revenue from streams using
--     this rate, so changing it updates every view immediately.
--
-- To change the global rate without a deploy:
--   UPDATE public.health_config SET value_numeric = <rate>, updated_at = now()
--   WHERE key = 'stream_payout_usd_per_stream';
-- then re-run the recompute cascade for any dates that should be restated.

INSERT INTO public.health_config (key, value_numeric, description)
VALUES (
  'stream_payout_usd_per_stream',
  0.002,
  'Estimated payout in USD per stream, used when precomputing playlist_daily_stats.est_revenue_*. Per-user display rate lives in user_settings.stream_payout_rate_per_k_usd.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.spotibase_stream_payout_rate()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT value_numeric FROM public.health_config WHERE key = 'stream_payout_usd_per_stream'),
    0.002
  );
$$;

COMMENT ON FUNCTION public.spotibase_stream_payout_rate() IS 'Global estimated payout USD/stream from health_config (fallback 0.002). Used by the playlist_daily_stats recompute functions.';

REVOKE ALL ON FUNCTION public.spotibase_stream_payout_rate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spotibase_stream_payout_rate() TO authenticated, service_role;

-- Both spotibase_recompute_playlist_daily_stats functions (public + competitor)
-- were recreated with `v_rate NUMERIC := public.spotibase_stream_payout_rate();`
-- replacing the literal 0.002; bodies are otherwise unchanged from the live
-- definitions. See the supabase_migrations history for the full statements.
