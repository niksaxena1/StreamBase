CREATE OR REPLACE FUNCTION competitor.playlist_current_tracks(
  playlist_key TEXT,
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    current_stats.streams_cumulative::bigint AS total,
    CASE
      WHEN previous_stats.streams_cumulative IS NULL OR current_stats.streams_cumulative IS NULL THEN NULL
      ELSE (current_stats.streams_cumulative - previous_stats.streams_cumulative)::bigint
    END AS daily
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams current_stats
    ON current_stats.isrc = m.isrc
   AND current_stats.date = $2
  LEFT JOIN LATERAL (
    SELECT s.streams_cumulative
    FROM competitor.track_daily_streams s
    WHERE s.isrc = m.isrc
      AND s.date < $2
    ORDER BY s.date DESC
    LIMIT 1
  ) previous_stats ON TRUE
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC;
$$;

GRANT EXECUTE ON FUNCTION competitor.playlist_current_tracks(text, date) TO service_role;
