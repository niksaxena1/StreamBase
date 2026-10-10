-- Minimum competitor read API for the v1 pilot:
-- competitor.search_all(q, max_results)
-- competitor.playlists_latest_track_counts(p_keys)
-- competitor.playlist_current_tracks(playlist_key, run_date)
-- competitor.playlist_removed_tracks(playlist_key, limit_rows)
-- competitor.playlist_top_tracks_total(playlist_key, run_date, limit_rows)
-- competitor.catalog_artist_series(artist_id, start_date, end_date)
-- competitor.catalog_artist_top_tracks_total(artist_id, run_date, limit_rows)
-- competitor.catalog_artist_top_tracks_daily(artist_id, run_date, limit_rows)

CREATE OR REPLACE FUNCTION competitor.playlists_latest_track_counts(p_keys TEXT[])
RETURNS TABLE (playlist_key TEXT, track_count INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (s.playlist_key)
    s.playlist_key,
    s.track_count
  FROM competitor.playlist_daily_stats s
  WHERE s.playlist_key = ANY (p_keys)
  ORDER BY s.playlist_key, s.date DESC;
$$;

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
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC;
$$;

CREATE OR REPLACE FUNCTION competitor.playlist_removed_tracks(
  playlist_key TEXT,
  limit_rows INT DEFAULT 500
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  valid_to DATE
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    m.valid_to::date AS valid_to
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  WHERE m.playlist_key = $1
    AND m.valid_to IS NOT NULL
  ORDER BY m.valid_to DESC, name ASC
  LIMIT GREATEST(COALESCE($2, 500), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.playlist_top_tracks_total(
  playlist_key TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($3, 200), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_series(
  artist_id TEXT,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE (
  date DATE,
  streams_cumulative BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.date,
    COALESCE(SUM(s.streams_cumulative), 0)::bigint AS streams_cumulative
  FROM competitor.track_daily_streams s
  JOIN competitor.tracks t USING (isrc)
  WHERE t.spotify_artist_ids @> ARRAY[$1]
    AND s.date BETWEEN $2 AND $3
  GROUP BY s.date
  ORDER BY s.date ASC;
$$;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_top_tracks_total(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 1000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.isrc,
    t.name,
    t.spotify_album_image_url::text AS album_image_url,
    today.streams_cumulative::bigint AS total,
    CASE
      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE today.streams_cumulative - prev.streams_cumulative
    END::bigint AS daily
  FROM competitor.tracks t
  LEFT JOIN competitor.track_daily_streams today
    ON today.isrc = t.isrc
   AND today.date = $2
  LEFT JOIN competitor.track_daily_streams prev
    ON prev.isrc = t.isrc
   AND prev.date = ($2 - INTERVAL '1 day')::date
  WHERE t.spotify_artist_ids @> ARRAY[$1]
  ORDER BY total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($3, 1000), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_top_tracks_daily(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 1000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM competitor.catalog_artist_top_tracks_total($1, $2, $3)
  ORDER BY daily DESC NULLS LAST, total DESC NULLS LAST, name ASC;
$$;

CREATE OR REPLACE FUNCTION competitor.search_all(q TEXT, max_results INT DEFAULT 30)
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
    FROM competitor.tracks t, needle
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
    FROM competitor.tracks t
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
    WHERE LOWER(p.display_name) LIKE needle.q
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
  LIMIT GREATEST(COALESCE($2, 30), 0);
$$;
