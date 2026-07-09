-- Migration: Revoke explicit anon grants from effective artist stats functions
--
-- Earlier migrations granted some catalog/override RPCs to anon. These functions
-- are used from authenticated/server paths, so anon does not need EXECUTE.

REVOKE EXECUTE ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) FROM anon;

GRANT EXECUTE ON FUNCTION public.catalog_artist_series_fast(TEXT, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spotibase_recompute_playlist_daily_stats_cascade(DATE, DATE) TO authenticated, service_role;
