-- Shared catalog tracks between two competitor labels (for overlap matrix drill-down).

CREATE OR REPLACE FUNCTION competitor.label_overlap_tracks(
  p_as_of DATE,
  p_label_a TEXT,
  p_label_b TEXT
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[]
)
LANGUAGE sql
STABLE
AS $$
  WITH active AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND p.label_key IN (p_label_a, p_label_b)
  ),
  shared AS (
    SELECT a.isrc
    FROM active a
    JOIN active b ON a.isrc = b.isrc
    WHERE a.label_key = p_label_a
      AND b.label_key = p_label_b
  )
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names
  FROM shared s
  JOIN competitor.tracks t ON t.isrc = s.isrc
  ORDER BY name NULLS LAST, isrc;
$$;

ALTER FUNCTION competitor.label_overlap_tracks(DATE, TEXT, TEXT) SET search_path = competitor, public;

COMMENT ON FUNCTION competitor.label_overlap_tracks(DATE, TEXT, TEXT) IS
  'ISRCs active in both competitor labels'' playlists at p_as_of (overlap matrix drill-down).';

GRANT EXECUTE ON FUNCTION competitor.label_overlap_tracks(DATE, TEXT, TEXT) TO service_role;
