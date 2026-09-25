-- Migration: Make unified search accent-insensitive (unaccent)
-- Run this in your Supabase SQL Editor

-- 1) Extension
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2) Update search_all RPC to use unaccent() on both query and indexed text.
-- Notes:
-- - We avoid expression indexes here (Supabase can be picky about IMMUTABLE).
-- - For our scale, trigram + FTS without expression indexes is still fast.
CREATE OR REPLACE FUNCTION public.search_all(q TEXT, max_results INT DEFAULT 30)
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
  WITH
    params AS (
      SELECT
        trim(coalesce(q, '')) AS q,
        greatest(coalesce(max_results, 30), 0) AS max_results
    ),
    q_norm AS (
      SELECT
        unaccent((SELECT q FROM params)) AS q_u,
        unaccent(lower((SELECT q FROM params))) AS ql_u,
        websearch_to_tsquery('simple'::regconfig, unaccent((SELECT q FROM params))) AS tsq_u
    ),
    -- Artists derived from tracks (ids + names arrays)
    artist_rows AS (
      SELECT
        a.artist_id::text AS artist_id,
        a.artist_name::text AS artist_name
      FROM public.tracks t
      CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
      WHERE a.artist_id IS NOT NULL
        AND a.artist_name IS NOT NULL
    ),
    artist_scored AS (
      SELECT
        ar.artist_id,
        ar.artist_name,
        count(*)::bigint AS track_count,
        (
          ts_rank_cd(to_tsvector('simple'::regconfig, unaccent(ar.artist_name)), (SELECT tsq_u FROM q_norm))
          + 0.25 * similarity(unaccent(lower(ar.artist_name)), (SELECT ql_u FROM q_norm))
          + CASE
              WHEN unaccent(lower(ar.artist_name)) = (SELECT ql_u FROM q_norm) THEN 2.0
              WHEN unaccent(lower(ar.artist_name)) LIKE (SELECT ql_u FROM q_norm) || '%' THEN 1.0
              ELSE 0.0
            END
        ) AS score
      FROM artist_rows ar
      WHERE
        to_tsvector('simple'::regconfig, unaccent(ar.artist_name)) @@ (SELECT tsq_u FROM q_norm)
        OR unaccent(lower(ar.artist_name)) LIKE '%' || (SELECT ql_u FROM q_norm) || '%'
        OR similarity(unaccent(lower(ar.artist_name)), (SELECT ql_u FROM q_norm)) > 0.2
      GROUP BY ar.artist_id, ar.artist_name
    ),
    artists AS (
      SELECT
        'artist'::text AS type,
        artist_id AS id,
        artist_name AS name,
        NULL::text AS subtitle,
        NULL::text AS image_url,
        track_count,
        NULL::text AS first_artist_id,
        NULL::text[] AS artist_ids,
        NULL::text[] AS artist_names,
        score,
        1 AS type_priority
      FROM artist_scored
      ORDER BY score DESC, track_count DESC, name ASC
      LIMIT 10
    ),
    tracks_scored AS (
      SELECT
        t.isrc::text AS id,
        coalesce(t.name, t.isrc)::text AS name,
        coalesce(array_to_string(t.spotify_artist_names, ', '), 'Unknown Artist')::text AS subtitle,
        t.spotify_album_image_url::text AS image_url,
        (t.spotify_artist_ids[1])::text AS first_artist_id,
        t.spotify_artist_ids::text[] AS artist_ids,
        t.spotify_artist_names::text[] AS artist_names,
        (
          ts_rank_cd(
            to_tsvector(
              'simple'::regconfig,
              unaccent(coalesce(t.name, '')) || ' ' || unaccent(coalesce(array_to_string(t.spotify_artist_names, ' '), ''))
            ),
            (SELECT tsq_u FROM q_norm)
          )
          + 0.15 * similarity(unaccent(lower(coalesce(t.name, ''))), (SELECT ql_u FROM q_norm))
        ) AS score
      FROM public.tracks t
      WHERE
        to_tsvector(
          'simple'::regconfig,
          unaccent(coalesce(t.name, '')) || ' ' || unaccent(coalesce(array_to_string(t.spotify_artist_names, ' '), ''))
        ) @@ (SELECT tsq_u FROM q_norm)
        OR unaccent(lower(coalesce(t.name, ''))) LIKE '%' || (SELECT ql_u FROM q_norm) || '%'
        OR similarity(unaccent(lower(coalesce(t.name, ''))), (SELECT ql_u FROM q_norm)) > 0.2
        OR lower(t.isrc) LIKE '%' || lower((SELECT q FROM params)) || '%'
    ),
    tracks AS (
      SELECT
        'track'::text AS type,
        id,
        name,
        subtitle,
        image_url,
        NULL::bigint AS track_count,
        first_artist_id,
        artist_ids,
        artist_names,
        score,
        2 AS type_priority
      FROM tracks_scored
      ORDER BY score DESC, name ASC
      LIMIT 20
    ),
    playlists_scored AS (
      SELECT
        p.playlist_key::text AS id,
        coalesce(p.display_name, p.playlist_key)::text AS name,
        NULL::text AS subtitle,
        p.spotify_playlist_image_url::text AS image_url,
        (
          ts_rank_cd(
            to_tsvector('simple'::regconfig, unaccent(coalesce(p.display_name, '') || ' ' || coalesce(p.playlist_key, ''))),
            (SELECT tsq_u FROM q_norm)
          )
          + 0.2 * similarity(unaccent(lower(coalesce(p.display_name, ''))), (SELECT ql_u FROM q_norm))
        ) AS score
      FROM public.playlists p
      WHERE
        to_tsvector('simple'::regconfig, unaccent(coalesce(p.display_name, '') || ' ' || coalesce(p.playlist_key, ''))) @@ (SELECT tsq_u FROM q_norm)
        OR unaccent(lower(coalesce(p.display_name, ''))) LIKE '%' || (SELECT ql_u FROM q_norm) || '%'
        OR similarity(unaccent(lower(coalesce(p.display_name, ''))), (SELECT ql_u FROM q_norm)) > 0.2
        OR unaccent(lower(coalesce(p.playlist_key, ''))) LIKE '%' || (SELECT ql_u FROM q_norm) || '%'
    ),
    playlists AS (
      SELECT
        'playlist'::text AS type,
        id,
        name,
        subtitle,
        image_url,
        NULL::bigint AS track_count,
        NULL::text AS first_artist_id,
        NULL::text[] AS artist_ids,
        NULL::text[] AS artist_names,
        score,
        3 AS type_priority
      FROM playlists_scored
      ORDER BY score DESC, name ASC
      LIMIT 10
    ),
    combined AS (
      SELECT * FROM artists
      UNION ALL
      SELECT * FROM tracks
      UNION ALL
      SELECT * FROM playlists
    )
  SELECT
    c.type,
    c.id,
    c.name,
    c.subtitle,
    c.image_url,
    c.track_count,
    c.first_artist_id,
    c.artist_ids,
    c.artist_names
  FROM combined c
  ORDER BY c.type_priority ASC, c.score DESC
  LIMIT (SELECT max_results FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.search_all(TEXT, INT) TO anon, authenticated;

