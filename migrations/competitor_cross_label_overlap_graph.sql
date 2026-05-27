-- Cross-competitor overlap graph for "All competitors" network view.
-- Nodes = active competitor labels; edges = shared ISRCs (or shared artists) between labels.

CREATE OR REPLACE FUNCTION competitor.cross_label_overlap_graph(
  p_basis text DEFAULT 'isrc'
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH
  basis_norm AS (
    SELECT CASE
      WHEN lower(btrim(coalesce(p_basis, 'isrc'))) = 'artist' THEN 'artist'
      ELSE 'isrc'
    END AS b
  ),
  active_labels AS (
    SELECT l.label_key, l.display_name
    FROM competitor.labels l
    WHERE l.is_active = true
  ),
  label_playlist_image AS (
    SELECT DISTINCT ON (p.label_key)
      p.label_key,
      p.spotify_playlist_image_url AS image_url
    FROM competitor.playlists p
    JOIN active_labels al ON al.label_key = p.label_key
    WHERE p.is_active = true
      AND p.spotify_playlist_image_url IS NOT NULL
    ORDER BY p.label_key, p.display_order NULLS LAST, p.playlist_key
  ),
  label_memberships AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
    JOIN active_labels al ON al.label_key = p.label_key
    WHERE p.is_active = true
      AND m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
  ),
  label_track_counts AS (
    SELECT label_key, count(DISTINCT isrc)::int AS track_count
    FROM label_memberships
    GROUP BY label_key
  ),
  label_artists AS (
    SELECT DISTINCT lm.label_key, a.artist_id
    FROM label_memberships lm
    JOIN competitor.tracks t ON t.isrc = lm.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
      AND a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  shared_isrc_pairs AS (
    SELECT
      a.label_key AS source_id,
      b.label_key AS target_id,
      a.isrc
    FROM label_memberships a
    JOIN label_memberships b
      ON a.isrc = b.isrc
     AND a.label_key < b.label_key
  ),
  shared_artist_pairs AS (
    SELECT
      a.label_key AS source_id,
      b.label_key AS target_id,
      a.artist_id AS entity_id
    FROM label_artists a
    JOIN label_artists b
      ON a.artist_id = b.artist_id
     AND a.label_key < b.label_key
  ),
  pair_entities AS (
    SELECT source_id, target_id, isrc AS entity_id
    FROM shared_isrc_pairs
    CROSS JOIN basis_norm bn
    WHERE bn.b = 'isrc'
    UNION ALL
    SELECT source_id, target_id, entity_id
    FROM shared_artist_pairs
    CROSS JOIN basis_norm bn
    WHERE bn.b = 'artist'
  ),
  edge_weights AS (
    SELECT source_id, target_id, count(DISTINCT entity_id)::int AS weight
    FROM pair_entities
    GROUP BY source_id, target_id
  ),
  edge_shared_tracks AS (
    SELECT
      pe.source_id,
      pe.target_id,
      json_agg(
        json_build_object(
          'isrc', t.isrc,
          'name', t.name,
          'album_image_url', t.spotify_album_image_url
        )
        ORDER BY t.name NULLS LAST, t.isrc
      ) AS shared_tracks
    FROM (
      SELECT DISTINCT ON (pe2.source_id, pe2.target_id, pe2.entity_id)
        pe2.source_id,
        pe2.target_id,
        pe2.entity_id
      FROM pair_entities pe2
      CROSS JOIN basis_norm bn
      WHERE bn.b = 'isrc'
      ORDER BY pe2.source_id, pe2.target_id, pe2.entity_id
      LIMIT 5000
    ) pe
    JOIN competitor.tracks t ON t.isrc = pe.entity_id
    GROUP BY pe.source_id, pe.target_id
  ),
  edges AS (
    SELECT
      ew.source_id,
      ew.target_id,
      ew.weight,
      (
        SELECT coalesce(json_agg(x ORDER BY x->>'name', x->>'isrc'), '[]'::json)
        FROM (
          SELECT elem AS x
          FROM json_array_elements(coalesce(est.shared_tracks, '[]'::json)) AS elem
          LIMIT 50
        ) sub
      ) AS shared_tracks
    FROM edge_weights ew
    LEFT JOIN edge_shared_tracks est
      ON est.source_id = ew.source_id
     AND est.target_id = ew.target_id
  ),
  nodes AS (
    SELECT
      al.label_key AS id,
      al.display_name AS name,
      coalesce(ltc.track_count, 0) AS track_count,
      lpi.image_url
    FROM active_labels al
    LEFT JOIN label_track_counts ltc ON ltc.label_key = al.label_key
    LEFT JOIN label_playlist_image lpi ON lpi.label_key = al.label_key
  )

  SELECT json_build_object(
    'nodes', coalesce((SELECT json_agg(
                json_build_object(
                  'id', n.id,
                  'name', n.name,
                  'track_count', n.track_count,
                  'co_artists_any_track', 0,
                  'co_artists_primary_tracks', 0,
                  'image_url', n.image_url
                )
                ORDER BY n.name
              ) FROM nodes n), '[]'::json),
    'edges', coalesce((SELECT json_agg(
                json_build_object(
                  'source', e.source_id,
                  'target', e.target_id,
                  'weight', e.weight,
                  'shared_tracks', e.shared_tracks
                )
              ) FROM edges e), '[]'::json)
  );
$$;

COMMENT ON FUNCTION competitor.cross_label_overlap_graph(text) IS
  'Cross-competitor overlap graph: nodes are labels, edges are shared ISRCs or artists (p_basis=isrc|artist).';

GRANT EXECUTE ON FUNCTION competitor.cross_label_overlap_graph(text) TO service_role;
