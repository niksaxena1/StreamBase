-- Daily refresh of the precomputed Catalog artist series (about 2 s; widens itself when overrides changed).
-- Runs after the pipeline window (04:00-12:55 UTC). The preferred hook is inside refresh_home_diag_snapshots
-- (owner paste: supabase/manual/2026-10-15_hook_catalog_artist_monthly_refresh.sql); this job is the safety net and
-- stays harmless once the hook is installed (the second run is a no-op rewrite of the same values).
select cron.schedule(
  'streambase-catalog-artist-monthly',
  '5 13 * * *',
  $$select public.refresh_catalog_artist_monthly(current_date)$$
);
