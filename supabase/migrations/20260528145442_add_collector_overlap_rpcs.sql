-- Pairwise catalog overlap matrix and drill-down for /collectors (own-catalog playlists).

CREATE OR REPLACE FUNCTION public.collector_overlap_matrix(
  p_as_of DATE DEFAULT CURRENT_DATE,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  collector_a TEXT,
  collector_b TEXT,
  shared_isrcs INT,
  collector_a_total INT,
  collector_b_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH collectors AS (
    SELECT DISTINCT upper(trim(p.collector)) AS collector
    FROM public.playlists p
    WHERE p.collector IS NOT NULL
      AND length(trim(p.collector)) > 0
    UNION
    SELECT 'TG'::text
    UNION
    SELECT 'PL'::text
  ),
  collector_playlists AS (
    SELECT c.collector, ep.playlist_key
    FROM collectors c
    CROSS JOIN LATERAL public.collector_effective_playlists(c.collector, $2) ep
  ),
  active AS (
    SELECT DISTINCT cp.collector, m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  totals AS (
    SELECT collector, COUNT(*)::int AS n
    FROM active
    GROUP BY collector
  )
  SELECT
    a.collector AS collector_a,
    b.collector AS collector_b,
    COUNT(*)::int AS shared_isrcs,
    ta.n AS collector_a_total,
    tb.n AS collector_b_total,
    ROUND(
      COUNT(*)::numeric / NULLIF((ta.n + tb.n - COUNT(*))::numeric, 0),
      4
    ) AS jaccard
  FROM active a
  JOIN active b ON a.isrc = b.isrc AND a.collector < b.collector
  JOIN totals ta ON ta.collector = a.collector
  JOIN totals tb ON tb.collector = b.collector
  GROUP BY a.collector, b.collector, ta.n, tb.n
  ORDER BY a.collector, b.collector;
$$;

CREATE OR REPLACE FUNCTION public.collector_overlap_artist_matrix(
  p_as_of DATE DEFAULT CURRENT_DATE,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  collector_a TEXT,
  collector_b TEXT,
  shared_artists INT,
  collector_a_total INT,
  collector_b_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH collectors AS (
    SELECT DISTINCT upper(trim(p.collector)) AS collector
    FROM public.playlists p
    WHERE p.collector IS NOT NULL
      AND length(trim(p.collector)) > 0
    UNION
    SELECT 'TG'::text
    UNION
    SELECT 'PL'::text
  ),
  collector_playlists AS (
    SELECT c.collector, ep.playlist_key
    FROM collectors c
    CROSS JOIN LATERAL public.collector_effective_playlists(c.collector, $2) ep
  ),
  active_tracks AS (
    SELECT DISTINCT cp.collector, m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  collector_artists AS (
    SELECT DISTINCT at.collector, btrim(u.aid) AS artist_id
    FROM active_tracks at
    JOIN public.tracks t ON t.isrc = at.isrc
    CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
    WHERE u.aid IS NOT NULL
      AND btrim(u.aid) <> ''
  ),
  totals AS (
    SELECT collector, COUNT(*)::int AS n
    FROM collector_artists
    GROUP BY collector
  )
  SELECT
    a.collector AS collector_a,
    b.collector AS collector_b,
    COUNT(*)::int AS shared_artists,
    ta.n AS collector_a_total,
    tb.n AS collector_b_total,
    ROUND(
      COUNT(*)::numeric / NULLIF((ta.n + tb.n - COUNT(*))::numeric, 0),
      4
    ) AS jaccard
  FROM collector_artists a
  JOIN collector_artists b ON a.artist_id = b.artist_id AND a.collector < b.collector
  JOIN totals ta ON ta.collector = a.collector
  JOIN totals tb ON tb.collector = b.collector
  GROUP BY a.collector, b.collector, ta.n, tb.n
  ORDER BY a.collector, b.collector;
$$;

CREATE OR REPLACE FUNCTION public.collector_overlap_tracks(
  p_as_of DATE,
  p_collector_a TEXT,
  p_collector_b TEXT,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[]
)
LANGUAGE sql
STABLE
AS $$
  WITH collectors AS (
    SELECT upper(coalesce($2, '')) AS collector
    UNION
    SELECT upper(coalesce($3, '')) AS collector
  ),
  collector_playlists AS (
    SELECT c.collector, ep.playlist_key
    FROM collectors c
    CROSS JOIN LATERAL public.collector_effective_playlists(c.collector, $4) ep
  ),
  active AS (
    SELECT DISTINCT cp.collector, m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  shared AS (
    SELECT a.isrc
    FROM active a
    JOIN active b ON a.isrc = b.isrc
    WHERE a.collector = upper(coalesce($2, ''))
      AND b.collector = upper(coalesce($3, ''))
  )
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names
  FROM shared s
  JOIN public.tracks t ON t.isrc = s.isrc
  ORDER BY name NULLS LAST, isrc;
$$;

CREATE OR REPLACE FUNCTION public.collector_overlap_artists(
  p_as_of DATE,
  p_collector_a TEXT,
  p_collector_b TEXT,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  artist_id TEXT,
  artist_name TEXT,
  image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH collectors AS (
    SELECT upper(coalesce($2, '')) AS collector
    UNION
    SELECT upper(coalesce($3, '')) AS collector
  ),
  collector_playlists AS (
    SELECT c.collector, ep.playlist_key
    FROM collectors c
    CROSS JOIN LATERAL public.collector_effective_playlists(c.collector, $4) ep
  ),
  active_tracks AS (
    SELECT DISTINCT cp.collector, m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  collector_artists AS (
    SELECT DISTINCT
      at.collector,
      btrim(a.artist_id) AS artist_id,
      NULLIF(btrim(a.artist_name), '') AS artist_name
    FROM active_tracks at
    JOIN public.tracks t ON t.isrc = at.isrc
    CROSS JOIN LATERAL unnest(
      COALESCE(t.spotify_artist_ids, ARRAY[]::text[]),
      COALESCE(t.spotify_artist_names, ARRAY[]::text[])
    ) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  shared AS (
    SELECT a.artist_id
    FROM collector_artists a
    JOIN collector_artists b ON a.artist_id = b.artist_id
    WHERE a.collector = upper(coalesce($2, ''))
      AND b.collector = upper(coalesce($3, ''))
  ),
  names AS (
    SELECT
      la.artist_id,
      MAX(la.artist_name) AS artist_name
    FROM collector_artists la
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

ALTER FUNCTION public.collector_overlap_matrix(DATE, BOOLEAN) SET search_path = public;
ALTER FUNCTION public.collector_overlap_artist_matrix(DATE, BOOLEAN) SET search_path = public;
ALTER FUNCTION public.collector_overlap_tracks(DATE, TEXT, TEXT, BOOLEAN) SET search_path = public;
ALTER FUNCTION public.collector_overlap_artists(DATE, TEXT, TEXT, BOOLEAN) SET search_path = public;

COMMENT ON FUNCTION public.collector_overlap_matrix(DATE, BOOLEAN) IS
  'Pairwise Jaccard similarity of active collector catalogs at p_as_of.';

COMMENT ON FUNCTION public.collector_overlap_artist_matrix(DATE, BOOLEAN) IS
  'Pairwise shared-artist counts between collectors at p_as_of.';

COMMENT ON FUNCTION public.collector_overlap_tracks(DATE, TEXT, TEXT, BOOLEAN) IS
  'ISRCs active in both collectors'' effective playlists at p_as_of.';

COMMENT ON FUNCTION public.collector_overlap_artists(DATE, TEXT, TEXT, BOOLEAN) IS
  'Spotify artists active in both collectors'' effective playlists at p_as_of.';

GRANT EXECUTE ON FUNCTION public.collector_overlap_matrix(DATE, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.collector_overlap_artist_matrix(DATE, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.collector_overlap_tracks(DATE, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.collector_overlap_artists(DATE, TEXT, TEXT, BOOLEAN) TO service_role;
