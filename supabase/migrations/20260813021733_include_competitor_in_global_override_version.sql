-- Backward-compatible cache invalidation for deployed Home builds that only call
-- public.spotibase_override_version(). This combines version metadata, not analytics.

CREATE OR REPLACE FUNCTION public.spotibase_override_version()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH own_version AS (
    SELECT COALESCE(MAX(id), 0) AS max_id, COUNT(*) AS row_count
    FROM public.track_daily_stream_overrides
  ),
  competitor_version AS (
    SELECT COALESCE(MAX(id), 0) AS max_id, COUNT(*) AS row_count
    FROM competitor.track_daily_stream_overrides
  )
  SELECT
    own_version.max_id::text || '-' || own_version.row_count::text ||
    '-comp' || competitor_version.max_id::text || '-' || competitor_version.row_count::text
  FROM own_version
  CROSS JOIN competitor_version;
$$;

COMMENT ON FUNCTION public.spotibase_override_version() IS
  'Global analytics cache-buster. Includes own-catalog and competitor override row versions without exposing override values.';

REVOKE ALL ON FUNCTION public.spotibase_override_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spotibase_override_version() TO authenticated, service_role;
