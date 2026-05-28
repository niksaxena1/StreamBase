-- Pairwise artist overlap matrix and drill-down for /competitors catalog overlap.

CREATE OR REPLACE FUNCTION competitor.label_overlap_artist_matrix(
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  label_a TEXT,
  label_b TEXT,
  shared_artists INT,
  label_a_total INT,
  label_b_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH active_tracks AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
  ),
  label_artists AS (
    SELECT DISTINCT at.label_key, btrim(u.aid) AS artist_id
    FROM active_tracks at
    JOIN competitor.tracks t ON t.isrc = at.isrc
    CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
    WHERE u.aid IS NOT NULL
      AND btrim(u.aid) <> ''
  ),
  totals AS (
    SELECT label_key, COUNT(*)::int AS n
    FROM label_artists
    GROUP BY label_key
  )
  SELECT
    a.label_key AS label_a,
    b.label_key AS label_b,
    COUNT(*)::int AS shared_artists,
    ta.n AS label_a_total,
    tb.n AS label_b_total,
    ROUND(
      COUNT(*)::numeric / NULLIF((ta.n + tb.n - COUNT(*))::numeric, 0),
      4
    ) AS jaccard
  FROM label_artists a
  JOIN label_artists b ON a.artist_id = b.artist_id AND a.label_key < b.label_key
  JOIN totals ta ON ta.label_key = a.label_key
  JOIN totals tb ON tb.label_key = b.label_key
  GROUP BY a.label_key, b.label_key, ta.n, tb.n
  ORDER BY a.label_key, b.label_key;
$$;

CREATE OR REPLACE FUNCTION competitor.label_overlap_artists(
  p_as_of DATE,
  p_label_a TEXT,
  p_label_b TEXT
)
RETURNS TABLE (
  artist_id TEXT,
  artist_name TEXT,
  image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH active_tracks AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND p.label_key IN (p_label_a, p_label_b)
  ),
  label_artists AS (
    SELECT DISTINCT
      at.label_key,
      btrim(a.artist_id) AS artist_id,
      NULLIF(btrim(a.artist_name), '') AS artist_name
    FROM active_tracks at
    JOIN competitor.tracks t ON t.isrc = at.isrc
    CROSS JOIN LATERAL unnest(
      COALESCE(t.spotify_artist_ids, ARRAY[]::text[]),
      COALESCE(t.spotify_artist_names, ARRAY[]::text[])
    ) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  shared AS (
    SELECT a.artist_id
    FROM label_artists a
    JOIN label_artists b ON a.artist_id = b.artist_id
    WHERE a.label_key = p_label_a
      AND b.label_key = p_label_b
  ),
  names AS (
    SELECT
      la.artist_id,
      MAX(la.artist_name) AS artist_name
    FROM label_artists la
    JOIN shared s ON s.artist_id = la.artist_id
    GROUP BY la.artist_id
  )
  SELECT
    n.artist_id,
    COALESCE(n.artist_name, n.artist_id)::text AS artist_name,
    sai.image_url::text AS image_url
  FROM names n
  LEFT JOIN public.spotify_artist_images sai ON sai.artist_id = n.artist_id
  ORDER BY artist_name NULLS LAST, n.artist_id;
$$;

ALTER FUNCTION competitor.label_overlap_artist_matrix(DATE) SET search_path = competitor, public;
ALTER FUNCTION competitor.label_overlap_artists(DATE, TEXT, TEXT) SET search_path = competitor, public;

COMMENT ON FUNCTION competitor.label_overlap_artist_matrix(DATE) IS
  'Pairwise shared-artist counts between competitor labels at p_as_of.';

COMMENT ON FUNCTION competitor.label_overlap_artists(DATE, TEXT, TEXT) IS
  'Spotify artists active in both competitor labels'' playlists at p_as_of.';

GRANT EXECUTE ON FUNCTION competitor.label_overlap_artist_matrix(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.label_overlap_artists(DATE, TEXT, TEXT) TO service_role;
