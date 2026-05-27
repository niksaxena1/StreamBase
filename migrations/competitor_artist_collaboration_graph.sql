-- Competitor-mode artist collaboration graph (scoped to one label_key).
-- Mirrors public.artist_collaboration_graph with competitor.* tables and label scoping.

CREATE OR REPLACE FUNCTION competitor.artist_collaboration_graph(
  p_label_key text,
  p_playlist_key text DEFAULT NULL,
  p_hide_non_primary boolean DEFAULT false,
  p_scope_playlists text[] DEFAULT NULL,
  p_scope_playlist_mode text DEFAULT 'any'
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH
  label_norm AS (
    SELECT btrim(coalesce(p_label_key, '')) AS label_key
  ),
  label_playlist_keys AS (
    SELECT coalesce(
      (
        SELECT array_agg(p.playlist_key ORDER BY p.display_order NULLS LAST, p.display_name)
        FROM competitor.playlists p
        WHERE p.label_key = ln.label_key
          AND p.is_active = true
      ),
      ARRAY[]::text[]
    ) AS keys
    FROM label_norm ln
    WHERE ln.label_key <> ''
    UNION ALL
    SELECT ARRAY[]::text[] AS keys
    FROM label_norm ln
    WHERE ln.label_key = ''
  ),
  scope_keys_raw AS (
    SELECT COALESCE(
      array_agg(DISTINCT btrim(x)) FILTER (WHERE x IS NOT NULL AND btrim(x) <> ''),
      ARRAY[]::text[]
    ) AS keys
    FROM unnest(coalesce(p_scope_playlists, array[]::text[])) AS t(x)
  ),
  scope_keys AS (
    SELECT coalesce(
      (
        SELECT array_agg(DISTINCT sk)
        FROM scope_keys_raw sr
        CROSS JOIN unnest(sr.keys) AS u(sk)
        CROSS JOIN label_playlist_keys lpk
        WHERE sk = ANY (lpk.keys)
      ),
      ARRAY[]::text[]
    ) AS keys
    FROM label_playlist_keys lpk
    LIMIT 1
  ),
  single_playlist_valid AS (
    SELECT CASE
      WHEN btrim(coalesce(p_playlist_key, '')) = '' THEN NULL::text
      WHEN btrim(p_playlist_key) = ANY (lpk.keys) THEN btrim(p_playlist_key)
      ELSE NULL::text
    END AS playlist_key
    FROM label_playlist_keys lpk
  ),
  key_count AS (
    SELECT coalesce(cardinality(sk.keys), 0) AS n
    FROM scope_keys sk
  ),
  mode_norm AS (
    SELECT CASE
      WHEN lower(btrim(coalesce(p_scope_playlist_mode, 'any'))) = 'all' THEN 'all'
      WHEN lower(btrim(coalesce(p_scope_playlist_mode, 'any'))) = 'none' THEN 'none'
      ELSE 'any'
    END AS m
  ),
  multi_active AS (
    SELECT (kc.n > 0) AS on
    FROM key_count kc
  ),

  multi_any AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    CROSS JOIN scope_keys sk
    CROSS JOIN mode_norm mn
    CROSS JOIN multi_active ma
    CROSS JOIN label_norm ln
    WHERE ma.on
      AND mn.m = 'any'
      AND m.playlist_key = ANY (sk.keys)
      AND m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      AND EXISTS (
        SELECT 1
        FROM competitor.playlists p
        WHERE p.playlist_key = m.playlist_key
          AND p.label_key = ln.label_key
      )
  ),

  multi_all AS (
    SELECT z.isrc
    FROM (
      SELECT m.isrc, count(DISTINCT m.playlist_key)::int AS pc
      FROM competitor.playlist_memberships m
      CROSS JOIN scope_keys sk
      CROSS JOIN mode_norm mn
      CROSS JOIN multi_active ma
      WHERE ma.on
        AND mn.m = 'all'
        AND m.playlist_key = ANY (sk.keys)
        AND m.valid_from <= CURRENT_DATE
        AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      GROUP BY m.isrc
    ) z
    CROSS JOIN key_count kc
    WHERE z.pc = kc.n AND kc.n > 0
  ),

  exclude_union AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    CROSS JOIN scope_keys sk
    CROSS JOIN mode_norm mn
    CROSS JOIN multi_active ma
    WHERE ma.on
      AND mn.m = 'none'
      AND m.playlist_key = ANY (sk.keys)
      AND m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
  ),

  label_scoped_isrcs AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
    CROSS JOIN label_norm ln
    WHERE ln.label_key <> ''
      AND p.label_key = ln.label_key
      AND m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
  ),

  multi_none AS (
    SELECT ls.isrc
    FROM label_scoped_isrcs ls
    CROSS JOIN mode_norm mn
    CROSS JOIN multi_active ma
    WHERE ma.on
      AND mn.m = 'none'
      AND NOT EXISTS (SELECT 1 FROM exclude_union x WHERE x.isrc = ls.isrc)
  ),

  single_playlist AS (
    SELECT DISTINCT cm.isrc
    FROM (
      SELECT u.isrc, max(u.valid_from) AS valid_from
      FROM (
        SELECT
          m.isrc,
          m.valid_from::date AS valid_from,
          m.valid_to::date AS valid_to
        FROM competitor.playlist_memberships m
        CROSS JOIN multi_active ma
        CROSS JOIN single_playlist_valid spv
        WHERE NOT ma.on
          AND spv.playlist_key IS NOT NULL
          AND m.playlist_key = spv.playlist_key
          AND m.valid_from <= CURRENT_DATE
          AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      ) u
      GROUP BY u.isrc
    ) cm
    CROSS JOIN multi_active ma
    CROSS JOIN single_playlist_valid spv
    WHERE NOT ma.on
      AND spv.playlist_key IS NOT NULL
  ),

  catalog_all AS (
    SELECT ls.isrc
    FROM label_scoped_isrcs ls
    CROSS JOIN multi_active ma
    CROSS JOIN single_playlist_valid spv
    CROSS JOIN label_norm ln
    WHERE NOT ma.on
      AND spv.playlist_key IS NULL
      AND ln.label_key <> ''
  ),

  scoped_isrcs AS (
    SELECT isrc FROM multi_any
    UNION ALL
    SELECT isrc FROM multi_all
    UNION ALL
    SELECT isrc FROM multi_none
    UNION ALL
    SELECT isrc FROM single_playlist
    UNION ALL
    SELECT isrc FROM catalog_all
  ),

  primary_rows AS (
    SELECT
      t.isrc,
      t.name AS track_name,
      t.spotify_artist_ids[1] AS artist_id,
      t.spotify_artist_names[1] AS artist_name
    FROM competitor.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  primary_artist_ids AS (
    SELECT DISTINCT pr.artist_id
    FROM primary_rows pr
  ),

  artist_tracks AS (
    SELECT
      t.isrc,
      t.name AS track_name,
      (t.spotify_album_image_url)::text AS album_image_url,
      a.artist_id,
      a.artist_name
    FROM competitor.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names)
      AS a(artist_id, artist_name)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  track_coartists AS (
    SELECT
      a1.artist_id,
      count(DISTINCT a2.artist_id)::bigint AS cnt
    FROM artist_tracks a1
    INNER JOIN artist_tracks a2
      ON a1.isrc = a2.isrc
     AND a2.artist_id <> a1.artist_id
    GROUP BY a1.artist_id
  ),

  primary_track_coartists AS (
    SELECT
      pr.artist_id,
      count(DISTINCT o.artist_id)::bigint AS cnt
    FROM primary_rows pr
    INNER JOIN artist_tracks o
      ON o.isrc = pr.isrc
     AND o.artist_id <> pr.artist_id
    GROUP BY pr.artist_id
  ),

  nodes_all AS (
    SELECT
      at2.artist_id,
      at2.artist_name,
      count(DISTINCT at2.isrc) AS track_count,
      sai.image_url
    FROM artist_tracks at2
    LEFT JOIN public.spotify_artist_images sai
      ON sai.artist_id = at2.artist_id
    GROUP BY at2.artist_id, at2.artist_name, sai.image_url
  ),

  nodes_primary_only AS (
    SELECT
      pr.artist_id,
      pr.artist_name,
      count(DISTINCT pr.isrc) AS track_count,
      sai.image_url
    FROM primary_rows pr
    LEFT JOIN public.spotify_artist_images sai
      ON sai.artist_id = pr.artist_id
    GROUP BY pr.artist_id, pr.artist_name, sai.image_url
  ),

  nodes AS (
    SELECT n.*
    FROM nodes_primary_only n
    WHERE p_hide_non_primary
    UNION ALL
    SELECT n.*
    FROM nodes_all n
    WHERE NOT p_hide_non_primary
  ),

  edge_tracks AS (
    SELECT
      a1.artist_id AS source_id,
      a2.artist_id AS target_id,
      a1.isrc,
      a1.track_name,
      a1.album_image_url
    FROM artist_tracks a1
    JOIN artist_tracks a2
      ON a1.isrc = a2.isrc
     AND a1.artist_id < a2.artist_id
    WHERE NOT p_hide_non_primary
       OR (
         a1.artist_id IN (SELECT pa.artist_id FROM primary_artist_ids pa)
         AND a2.artist_id IN (SELECT pa.artist_id FROM primary_artist_ids pa)
       )
  ),

  edges AS (
    SELECT
      et.source_id,
      et.target_id,
      count(*) AS weight,
      json_agg(
        json_build_object(
          'isrc', et.isrc,
          'name', et.track_name,
          'album_image_url', et.album_image_url
        ) ORDER BY et.track_name
      ) AS shared_tracks
    FROM edge_tracks et
    GROUP BY et.source_id, et.target_id
  )

  SELECT json_build_object(
    'nodes', coalesce((SELECT json_agg(
                json_build_object(
                  'id', n.artist_id,
                  'name', n.artist_name,
                  'track_count', n.track_count,
                  'co_artists_any_track', coalesce(tc.cnt, 0),
                  'co_artists_primary_tracks', coalesce(ptc.cnt, 0),
                  'image_url', n.image_url
                )
              )
              FROM nodes n
              LEFT JOIN track_coartists tc ON tc.artist_id = n.artist_id
              LEFT JOIN primary_track_coartists ptc ON ptc.artist_id = n.artist_id
             ), '[]'::json),
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

COMMENT ON FUNCTION competitor.artist_collaboration_graph(text, text, boolean, text[], text) IS
  'Competitor artist collaboration graph for one label_key; playlist scope uses competitor.playlists/memberships.';

GRANT EXECUTE ON FUNCTION competitor.artist_collaboration_graph(text, text, boolean, text[], text) TO service_role;
