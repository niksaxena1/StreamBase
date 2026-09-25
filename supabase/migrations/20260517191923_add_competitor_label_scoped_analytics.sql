CREATE OR REPLACE FUNCTION competitor.search_all_for_label(
  q TEXT,
  label_key TEXT,
  max_results INT DEFAULT 30
)
RETURNS TABLE (
  type TEXT,
  id TEXT,
  name TEXT,
  subtitle TEXT,
  image_url TEXT,
  track_count BIGINT,
  first_artist_id TEXT,
  artist_ids TEXT[],
  artist_names TEXT[]
)
LANGUAGE sql
STABLE
AS $$
  WITH needle AS (
    SELECT '%' || LOWER(TRIM($1)) || '%' AS q
  ),
  scoped_playlists AS (
    SELECT playlist_key
    FROM competitor.playlists
    WHERE competitor.playlists.label_key = $2
  ),
  scoped_isrcs AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN scoped_playlists p USING (playlist_key)
  ),
  scoped_tracks AS (
    SELECT t.*
    FROM competitor.tracks t
    JOIN scoped_isrcs s USING (isrc)
  ),
  track_rows AS (
    SELECT
      'track'::text AS type,
      t.isrc::text AS id,
      COALESCE(t.name, t.isrc)::text AS name,
      COALESCE(array_to_string(t.spotify_artist_names, ', '), '')::text AS subtitle,
      t.spotify_album_image_url::text AS image_url,
      NULL::bigint AS track_count,
      t.spotify_artist_ids[1]::text AS first_artist_id,
      t.spotify_artist_ids::text[] AS artist_ids,
      t.spotify_artist_names::text[] AS artist_names,
      1 AS rank_bucket
    FROM scoped_tracks t, needle
    WHERE LOWER(COALESCE(t.name, '')) LIKE needle.q
       OR LOWER(COALESCE(t.isrc, '')) LIKE needle.q
       OR LOWER(COALESCE(array_to_string(t.spotify_artist_names, ', '), '')) LIKE needle.q
  ),
  artist_rows AS (
    SELECT
      'artist'::text AS type,
      artist_id::text AS id,
      artist_name::text AS name,
      COUNT(*)::text AS subtitle,
      NULL::text AS image_url,
      COUNT(*)::bigint AS track_count,
      artist_id::text AS first_artist_id,
      NULL::text[] AS artist_ids,
      NULL::text[] AS artist_names,
      2 AS rank_bucket
    FROM scoped_tracks t
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
    CROSS JOIN needle
    WHERE LOWER(COALESCE(a.artist_name, '')) LIKE needle.q
    GROUP BY artist_id, artist_name
  ),
  playlist_rows AS (
    SELECT
      'playlist'::text AS type,
      p.playlist_key::text AS id,
      p.display_name::text AS name,
      l.display_name::text AS subtitle,
      p.spotify_playlist_image_url::text AS image_url,
      NULL::bigint AS track_count,
      NULL::text AS first_artist_id,
      NULL::text[] AS artist_ids,
      NULL::text[] AS artist_names,
      3 AS rank_bucket
    FROM competitor.playlists p
    JOIN competitor.labels l USING (label_key)
    CROSS JOIN needle
    WHERE p.label_key = $2
      AND LOWER(p.display_name) LIKE needle.q
  )
  SELECT type, id, name, subtitle, image_url, track_count, first_artist_id, artist_ids, artist_names
  FROM (
    SELECT * FROM track_rows
    UNION ALL
    SELECT * FROM artist_rows
    UNION ALL
    SELECT * FROM playlist_rows
  ) rows
  ORDER BY rank_bucket, name ASC
  LIMIT GREATEST(COALESCE($3, 30), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.home_track_scatter_points_for_label(
  label_key TEXT,
  run_date DATE,
  prev_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  release_date DATE,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT,
  spotify_track_id TEXT,
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT,
  has_prev_day BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH scoped_playlists AS (
    SELECT playlist_key
    FROM competitor.playlists
    WHERE competitor.playlists.label_key = $1
  ),
  scoped_isrcs AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN scoped_playlists p USING (playlist_key)
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  )
  SELECT
    t.isrc,
    t.name,
    t.release_date,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_track_id::text AS spotify_track_id,
    today.streams_cumulative::bigint AS total_streams_cumulative,
    CASE
      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE today.streams_cumulative - prev.streams_cumulative
    END::bigint AS daily_streams_delta,
    prev.streams_cumulative IS NOT NULL AS has_prev_day
  FROM scoped_isrcs s
  JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams today
    ON today.isrc = t.isrc
   AND today.date = $2
  LEFT JOIN competitor.track_daily_streams prev
    ON prev.isrc = t.isrc
   AND prev.date = $3
  WHERE today.streams_cumulative IS NOT NULL
  ORDER BY total_streams_cumulative DESC NULLS LAST, t.name ASC;
$$;

ALTER FUNCTION competitor.search_all_for_label(TEXT, TEXT, INT) SET search_path = competitor, public;
ALTER FUNCTION competitor.home_track_scatter_points_for_label(TEXT, DATE, DATE) SET search_path = competitor, public;
