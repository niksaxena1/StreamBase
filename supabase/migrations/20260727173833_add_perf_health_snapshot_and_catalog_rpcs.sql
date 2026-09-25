-- Migration: page-load performance support objects
--
-- 1) health_active_warning_snapshots: precomputed result of the web app's active-warning
--    pipeline (activeWarnings.ts). The shell nav badge renders on every page; before this
--    it recomputed expensive RPCs (health_negative_daily_streams ~1.2s,
--    health_playlist_missing_catalog_tracks ~0.4s x N playlists). Warnings only change at
--    ingestion or through health admin actions, so the app now reads this single row and
--    recomputes+upserts on miss / on revalidation.
CREATE TABLE IF NOT EXISTS public.health_active_warning_snapshots (
  run_date DATE PRIMARY KEY,
  summary JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.health_active_warning_snapshots IS 'Precomputed ActiveWarningSummary (web activeWarnings.ts) per run date. Written by the web app (service role) on recompute; deleted/upserted when health data changes.';

ALTER TABLE public.health_active_warning_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_active_warning_snapshots TO service_role;

-- 2) Cheap override "version" for cache-busting: replaces PostgREST
--    `select id, count=exact` head scans issued on every home/catalog render with a single
--    fast index-only aggregate round trip.
CREATE OR REPLACE FUNCTION public.spotibase_override_version()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(id), 0)::text || '-' || COUNT(*)::text
  FROM public.track_daily_stream_overrides;
$$;

COMMENT ON FUNCTION public.spotibase_override_version() IS 'Cache-buster: changes when overrides are added (max id) or removed (count). Single index-only aggregate.';

REVOKE ALL ON FUNCTION public.spotibase_override_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spotibase_override_version() TO authenticated, service_role;

-- 3) Catalog artist dropdown computed in SQL: replaces paging up to 10k track rows to the
--    web server and deriving distinct artists in JS.
CREATE OR REPLACE FUNCTION public.catalog_artist_options(max_tracks INTEGER DEFAULT 10000)
RETURNS TABLE (id TEXT, name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT spotify_artist_ids, spotify_artist_names
    FROM public.tracks
    WHERE spotify_artist_ids IS NOT NULL
    ORDER BY last_seen DESC
    LIMIT max_tracks
  ),
  pairs AS (
    SELECT DISTINCT ON (a.id) a.id, a.name
    FROM recent r
    CROSS JOIN LATERAL unnest(r.spotify_artist_ids, r.spotify_artist_names) AS a(id, name)
    WHERE a.id IS NOT NULL AND a.name IS NOT NULL AND a.id <> '' AND a.name <> ''
  )
  SELECT id, name FROM pairs ORDER BY name ASC;
$$;

COMMENT ON FUNCTION public.catalog_artist_options(integer) IS 'Distinct (artist id, name) pairs from the most recently seen tracks, sorted by name. Feeds the catalog artist dropdown.';

REVOKE ALL ON FUNCTION public.catalog_artist_options(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_artist_options(integer) TO authenticated, service_role;
