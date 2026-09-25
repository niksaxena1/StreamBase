-- Paged label drilldowns for /competitors comparison table (tracks + artists).

CREATE OR REPLACE FUNCTION competitor.label_tracks_paged(
  p_label_key TEXT,
  p_run_date DATE,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_label_key
      AND m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
  )
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    COALESCE(today.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE (today.streams_cumulative - prev.streams_cumulative)::bigint
    END AS daily_streams_delta
  FROM scoped s
  JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams today
    ON today.isrc = s.isrc AND today.date = p_run_date
  LEFT JOIN competitor.track_daily_streams prev
    ON prev.isrc = s.isrc AND prev.date = p_run_date - INTERVAL '1 day'
  ORDER BY COALESCE(today.streams_cumulative, 0) DESC NULLS LAST, t.name ASC
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 200), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.label_artists_paged(
  p_label_key TEXT,
  p_run_date DATE,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 200
)
RETURNS TABLE (
  artist_id TEXT,
  name TEXT,
  image_url TEXT,
  track_count BIGINT,
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_label_key
      AND m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
  ),
  track_rows AS (
    SELECT
      t.isrc,
      t.spotify_artist_ids,
      t.spotify_artist_names,
      t.spotify_album_image_url,
      COALESCE(today.streams_cumulative, 0)::bigint AS total_streams_cumulative,
      CASE
        WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
        ELSE (today.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams_delta
    FROM scoped s
    JOIN competitor.tracks t USING (isrc)
    LEFT JOIN competitor.track_daily_streams today
      ON today.isrc = s.isrc AND today.date = p_run_date
    LEFT JOIN competitor.track_daily_streams prev
      ON prev.isrc = s.isrc AND prev.date = p_run_date - INTERVAL '1 day'
  ),
  artist_rows AS (
    SELECT
      a.artist_id,
      a.artist_name,
      MAX(tr.spotify_album_image_url)::text AS image_url,
      COUNT(DISTINCT tr.isrc)::bigint AS track_count,
      SUM(tr.total_streams_cumulative)::bigint AS total_streams_cumulative,
      SUM(COALESCE(tr.daily_streams_delta, 0))::bigint AS daily_streams_delta
    FROM track_rows tr
    CROSS JOIN LATERAL unnest(tr.spotify_artist_ids, tr.spotify_artist_names) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL AND a.artist_name IS NOT NULL
    GROUP BY a.artist_id, a.artist_name
  )
  SELECT
    artist_id,
    artist_name AS name,
    image_url,
    track_count,
    total_streams_cumulative,
    daily_streams_delta
  FROM artist_rows
  ORDER BY total_streams_cumulative DESC NULLS LAST, name ASC
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 200), 0);
$$;

ALTER FUNCTION competitor.label_tracks_paged(TEXT, DATE, INT, INT) SET search_path = competitor, public;
ALTER FUNCTION competitor.label_artists_paged(TEXT, DATE, INT, INT) SET search_path = competitor, public;
