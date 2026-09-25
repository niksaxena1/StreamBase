-- Health page enhancements for competitor mode (/health in competitor dataset).

CREATE OR REPLACE FUNCTION competitor.label_distinct_track_counts(p_run_date DATE)
RETURNS TABLE (label_key TEXT, track_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = competitor, public
AS $$
  SELECT
    p.label_key,
    COUNT(DISTINCT m.isrc)::bigint AS track_count
  FROM competitor.playlist_memberships m
  JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
  WHERE m.valid_from <= p_run_date
    AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
  GROUP BY p.label_key;
$$;

COMMENT ON FUNCTION competitor.label_distinct_track_counts(DATE) IS
  'Distinct active ISRCs per competitor label at p_run_date (catalog size).';

CREATE OR REPLACE FUNCTION competitor.unenriched_tracks_paged(
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  missing_artists BOOLEAN,
  missing_image BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = competitor, public
AS $$
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    (t.spotify_artist_ids IS NULL OR array_length(t.spotify_artist_ids, 1) IS NULL)::boolean AS missing_artists,
    (t.spotify_album_image_url IS NULL)::boolean AS missing_image
  FROM competitor.tracks t
  WHERE t.spotify_artist_ids IS NULL
     OR t.spotify_album_image_url IS NULL
     OR array_length(t.spotify_artist_ids, 1) IS NULL
  ORDER BY t.name NULLS LAST, t.isrc
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$$;

COMMENT ON FUNCTION competitor.unenriched_tracks_paged(INT, INT) IS
  'Paged competitor tracks missing Spotify artist IDs and/or album artwork.';

CREATE MATERIALIZED VIEW IF NOT EXISTS competitor.health_warning_history_mv AS
SELECT
  run_date,
  code,
  severity,
  count(*)::bigint AS warning_count
FROM competitor.ingestion_warnings
WHERE severity IN ('critical', 'warn')
GROUP BY run_date, code, severity
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS competitor_health_warning_history_mv_pk
  ON competitor.health_warning_history_mv (run_date, code, severity);

CREATE INDEX IF NOT EXISTS competitor_health_warning_history_mv_run_date_idx
  ON competitor.health_warning_history_mv (run_date DESC);

CREATE OR REPLACE FUNCTION competitor.refresh_health_warning_history_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = competitor, public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY competitor.health_warning_history_mv;
END;
$$;

GRANT EXECUTE ON FUNCTION competitor.label_distinct_track_counts(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.unenriched_tracks_paged(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.refresh_health_warning_history_mv() TO service_role;
