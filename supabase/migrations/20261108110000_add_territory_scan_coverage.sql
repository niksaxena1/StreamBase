-- Territory scan coverage for Health.
--
-- Counts the catalog the nightly territory scan works on (the same candidate set:
-- public.spotify_availability_candidates() rows that have a Spotify track id) and
-- lists the tracks the scan is NOT currently checking:
--   taken_down  : the takedown watch marks the track unavailable, so the scan skips it
--                 until it is back (its stored row stays untouched);
--   not_checked : a catalog track with a Spotify id but no territory row yet.
-- One bounded call (list capped at p_list_limit); web reads it server-side with the
-- service role and caches it for an hour. Backend-only, like the tables it reads.
CREATE OR REPLACE FUNCTION public.territory_scan_coverage(
  p_lookback_days INT DEFAULT 30,
  p_list_limit INT DEFAULT 500
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cand AS (
    SELECT c.isrc, c.name, c.artist_names
    FROM public.spotify_availability_candidates(p_lookback_days) c
    WHERE btrim(coalesce(c.spotify_track_id, '')) <> ''
  ),
  state AS (
    SELECT
      c.isrc,
      c.name,
      c.artist_names,
      CASE
        WHEN a.status = 'unavailable' THEN 'taken_down'
        WHEN m.isrc IS NULL THEN 'not_checked'
      END AS reason
    FROM cand c
    LEFT JOIN public.spotify_track_availability a ON a.isrc = c.isrc
    LEFT JOIN public.spotify_track_market_availability m ON m.isrc = c.isrc
  ),
  unchecked AS (
    SELECT * FROM state WHERE reason IS NOT NULL
  )
  SELECT jsonb_build_object(
    'catalog_total', (SELECT count(*) FROM cand),
    'unchecked_total', (SELECT count(*) FROM unchecked),
    'unchecked', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(u) ORDER BY u.reason, u.isrc)
        FROM (SELECT * FROM unchecked ORDER BY reason, isrc LIMIT GREATEST(1, p_list_limit)) u
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.territory_scan_coverage(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.territory_scan_coverage(INT, INT) TO service_role;
