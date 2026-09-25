-- Migration: Harden grants for effective artist daily stats functions
--
-- `CREATE OR REPLACE FUNCTION` can leave EXECUTE available through PUBLIC.
-- Revoke PUBLIC first, then grant only the roles that need each function.

REVOKE EXECUTE ON FUNCTION public.refresh_artist_daily_stats(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_artist_daily_stats(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) TO authenticated, service_role;
