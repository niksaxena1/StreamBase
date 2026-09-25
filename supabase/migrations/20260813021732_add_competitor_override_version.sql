-- Cheap competitor override version for cache invalidation.
-- The service-role-only RPC avoids transferring override rows on every render.

CREATE OR REPLACE FUNCTION competitor.spotibase_override_version()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = competitor, public
AS $$
  SELECT COALESCE(MAX(id), 0)::text || '-' || COUNT(*)::text
  FROM competitor.track_daily_stream_overrides;
$$;

COMMENT ON FUNCTION competitor.spotibase_override_version() IS
  'Cache-buster that changes when competitor stream override rows are added or removed.';

REVOKE ALL ON FUNCTION competitor.spotibase_override_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.spotibase_override_version() TO service_role;
