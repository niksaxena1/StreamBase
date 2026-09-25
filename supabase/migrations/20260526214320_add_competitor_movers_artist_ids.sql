-- Add spotify artist ids to movers RPC for catalog artist links.

DROP FUNCTION IF EXISTS competitor.label_top_tracks_daily(DATE, INT, TEXT);

CREATE OR REPLACE FUNCTION competitor.label_top_tracks_daily(
  p_run_date DATE,
  p_limit INT DEFAULT 20,
  p_direction TEXT DEFAULT 'gainers'
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  label_keys TEXT[],
  daily_delta BIGINT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH today AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams s
    WHERE s.date = p_run_date
  ),
  yday AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams s
    WHERE s.date = p_run_date - INTERVAL '1 day'
  ),
  active_membership AS (
    SELECT m.isrc, array_agg(DISTINCT p.label_key) AS label_keys
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
    GROUP BY m.isrc
  )
  SELECT
    ranked.isrc,
    ranked.name,
    ranked.album_image_url,
    ranked.artist_names,
    ranked.artist_ids,
    ranked.label_keys,
    ranked.daily_delta,
    ranked.total
  FROM (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url,
      t.spotify_artist_names::text[] AS artist_names,
      t.spotify_artist_ids::text[] AS artist_ids,
      am.label_keys,
      (COALESCE(today.streams_cumulative, 0) - COALESCE(yday.streams_cumulative, 0))::bigint AS daily_delta,
      COALESCE(today.streams_cumulative, 0)::bigint AS total
    FROM competitor.tracks t
    JOIN active_membership am USING (isrc)
    LEFT JOIN today USING (isrc)
    LEFT JOIN yday USING (isrc)
    WHERE today.streams_cumulative IS NOT NULL
      AND yday.streams_cumulative IS NOT NULL
  ) ranked
  ORDER BY
    CASE WHEN lower(p_direction) = 'losers' THEN ranked.daily_delta END ASC NULLS LAST,
    CASE WHEN lower(p_direction) <> 'losers' THEN ranked.daily_delta END DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 20), 0);
$$;

ALTER FUNCTION competitor.label_top_tracks_daily(DATE, INT, TEXT) SET search_path = competitor, public;
