-- Security hardening: remove direct PostgREST anon access to analytics RPCs and tighten RLS.
-- After this migration, callers must use the authenticated role (logged-in Supabase session)
-- or server-side service_role. Apply in Supabase SQL Editor or via migration runner.
--
-- Prerequisites: public.is_admin() exists (used elsewhere for admin RLS).

-- ---------------------------------------------------------------------------
-- 1) REVOKE EXECUTE ... FROM anon (keep authenticated + service_role patterns)
-- ---------------------------------------------------------------------------
-- Core search & stats
REVOKE EXECUTE ON FUNCTION public.search_all(text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_artists(text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.spotibase_system_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.spotibase_docs_inventory() FROM anon;

-- Aggregates & series (duplicate signatures listed once each)
REVOKE EXECUTE ON FUNCTION public.artist_total_streams_for_date(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_total_streams_for_date(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.catalog_artist_series(text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.catalog_artist_top_tracks_total(text, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.catalog_artist_top_tracks_daily(text, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.track_total_streams_for_date(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.track_series(text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_series(text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_top_tracks_total(text, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_top_tracks(text, date, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_added_tracks(text, date, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_removed_tracks(text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.playlist_distinct_artist_count(text, date) FROM anon;

-- Collectors
REVOKE EXECUTE ON FUNCTION public.collector_tracks(text, date, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.collector_tracks_paged(text, date, date, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.collector_artists_paged(text, date, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.collector_artists_stats_paged(text, date, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.collector_artist_counts_for_date(date) FROM anon;

-- Health RPCs
REVOKE EXECUTE ON FUNCTION public.health_playlist_missing_catalog_tracks(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.health_missing_catalog_tracks(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.health_unplayable_candidates(date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.health_playlist_missing_enrichment_tracks(text, date, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.health_track_count_swing_tracks(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.health_negative_daily_streams(text) FROM anon;

-- Home / dashboards
REVOKE EXECUTE ON FUNCTION public.home_negative_daily_streams() FROM anon;
REVOKE EXECUTE ON FUNCTION public.home_track_scatter_points(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.home_track_weekend_dips(numeric, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.home_artist_weekend_dips(numeric, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.home_artificial_stream_spikes(numeric, numeric, integer, bigint, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.home_artificial_stream_spikes(numeric, numeric, integer, bigint, boolean, date, date) FROM anon;

-- SAI docs search (vectors)
REVOKE EXECUTE ON FUNCTION public.sai_docs_search(double precision[], int) FROM anon;

-- ---------------------------------------------------------------------------
-- 2) Optional: anon should not SELECT the public stream view directly
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.track_daily_streams_effective_public FROM anon;

-- ---------------------------------------------------------------------------
-- 3) saved_filters: per-user RLS (revert team-wide policies)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read all saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Authenticated users can insert saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Authenticated users can update saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Authenticated users can delete saved filters" ON public.saved_filters;

DROP POLICY IF EXISTS "Users can manage their own saved filters" ON public.saved_filters;

CREATE POLICY "Users can manage their own saved filters"
  ON public.saved_filters
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4) health_warning_exclusions: admin-only (matches health_config pattern)
-- ---------------------------------------------------------------------------
ALTER TABLE public.health_warning_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage health_warning_exclusions" ON public.health_warning_exclusions;

CREATE POLICY "Admins manage health_warning_exclusions"
  ON public.health_warning_exclusions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5) SECURITY DEFINER refresh: callable only by service_role (ingestion / ops)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.refresh_health_warning_history_mv() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_health_warning_history_mv() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_health_warning_history_mv() TO service_role;
