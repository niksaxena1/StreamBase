-- RPC: artist_collaboration_graph
-- Returns a JSON object with { nodes, edges } for rendering an interactive
-- force-directed artist collaboration graph.
--
-- Nodes: every unique artist in the catalog with track_count and image_url.
-- Edges: every pair of artists that share at least one track, with the count
--        of shared tracks and their names/ISRCs.

CREATE OR REPLACE FUNCTION artist_collaboration_graph()
RETURNS json
LANGUAGE sql STABLE
AS $$
  WITH artist_tracks AS (
    -- Unnest the artist arrays so each (artist, track) combination is a row.
    SELECT t.isrc,
           t.name                     AS track_name,
           a.artist_id,
           a.artist_name
    FROM tracks t
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names)
         AS a(artist_id, artist_name)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  nodes AS (
    -- One row per unique artist with their track count and optional image.
    SELECT at2.artist_id,
           at2.artist_name,
           COUNT(DISTINCT at2.isrc)        AS track_count,
           sai.image_url
    FROM artist_tracks at2
    LEFT JOIN spotify_artist_images sai
           ON sai.artist_id = at2.artist_id
    GROUP BY at2.artist_id, at2.artist_name, sai.image_url
  ),

  edge_tracks AS (
    -- For each track with 2+ artists, pair every combination (ordered) and
    -- collect the track info.
    SELECT a1.artist_id  AS source_id,
           a2.artist_id  AS target_id,
           a1.isrc,
           a1.track_name
    FROM artist_tracks a1
    JOIN artist_tracks a2
      ON a1.isrc = a2.isrc
     AND a1.artist_id < a2.artist_id          -- avoid duplicates & self-loops
  ),

  edges AS (
    SELECT et.source_id,
           et.target_id,
           COUNT(*)                            AS weight,
           json_agg(
             json_build_object(
               'isrc', et.isrc,
               'name', et.track_name
             ) ORDER BY et.track_name
           )                                   AS shared_tracks
    FROM edge_tracks et
    GROUP BY et.source_id, et.target_id
  )

  SELECT json_build_object(
    'nodes', COALESCE((SELECT json_agg(
                json_build_object(
                  'id',          n.artist_id,
                  'name',        n.artist_name,
                  'track_count', n.track_count,
                  'image_url',   n.image_url
                )
              ) FROM nodes n), '[]'::json),
    'edges', COALESCE((SELECT json_agg(
                json_build_object(
                  'source',        e.source_id,
                  'target',        e.target_id,
                  'weight',        e.weight,
                  'shared_tracks', e.shared_tracks
                )
              ) FROM edges e), '[]'::json)
  );
$$;
