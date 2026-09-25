-- Extend artist_collaboration_graph with optional playlist scope.
-- When p_playlist_key IS NULL: same as before (all tracks in catalog).
-- When set: only tracks currently active on that playlist (membership as of CURRENT_DATE).

DROP FUNCTION IF EXISTS public.artist_collaboration_graph();

CREATE OR REPLACE FUNCTION public.artist_collaboration_graph(p_playlist_key text DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH scoped_isrcs AS (
    SELECT DISTINCT cm.isrc
    FROM (
      SELECT u.isrc, MAX(u.valid_from) AS valid_from
      FROM (
        SELECT
          m.isrc,
          m.valid_from::date AS valid_from,
          m.valid_to::date AS valid_to
        FROM public.playlist_memberships m
        WHERE p_playlist_key IS NOT NULL
          AND m.playlist_key = p_playlist_key
          AND m.valid_from <= CURRENT_DATE
          AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      ) u
      GROUP BY u.isrc
    ) cm
    WHERE p_playlist_key IS NOT NULL

    UNION ALL

    SELECT t.isrc
    FROM public.tracks t
    WHERE p_playlist_key IS NULL
  ),

  artist_tracks AS (
    SELECT
      t.isrc,
      t.name AS track_name,
      a.artist_id,
      a.artist_name
    FROM public.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names)
      AS a(artist_id, artist_name)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  nodes AS (
    SELECT
      at2.artist_id,
      at2.artist_name,
      COUNT(DISTINCT at2.isrc) AS track_count,
      sai.image_url
    FROM artist_tracks at2
    LEFT JOIN spotify_artist_images sai
      ON sai.artist_id = at2.artist_id
    GROUP BY at2.artist_id, at2.artist_name, sai.image_url
  ),

  edge_tracks AS (
    SELECT
      a1.artist_id AS source_id,
      a2.artist_id AS target_id,
      a1.isrc,
      a1.track_name
    FROM artist_tracks a1
    JOIN artist_tracks a2
      ON a1.isrc = a2.isrc
     AND a1.artist_id < a2.artist_id
  ),

  edges AS (
    SELECT
      et.source_id,
      et.target_id,
      COUNT(*) AS weight,
      json_agg(
        json_build_object(
          'isrc', et.isrc,
          'name', et.track_name
        ) ORDER BY et.track_name
      ) AS shared_tracks
    FROM edge_tracks et
    GROUP BY et.source_id, et.target_id
  )

  SELECT json_build_object(
    'nodes', COALESCE((SELECT json_agg(
                json_build_object(
                  'id', n.artist_id,
                  'name', n.artist_name,
                  'track_count', n.track_count,
                  'image_url', n.image_url
                )
              ) FROM nodes n), '[]'::json),
    'edges', COALESCE((SELECT json_agg(
                json_build_object(
                  'source', e.source_id,
                  'target', e.target_id,
                  'weight', e.weight,
                  'shared_tracks', e.shared_tracks
                )
              ) FROM edges e), '[]'::json)
  );
$$;
