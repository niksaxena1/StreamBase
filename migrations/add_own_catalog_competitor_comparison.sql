-- Own-catalog vs competitor comparisons for /competitors (public catalog + competitor schema).

CREATE OR REPLACE FUNCTION public.playlist_daily_stats_as_of(p_as_of_date DATE)
RETURNS TABLE (
  playlist_key TEXT,
  date DATE,
  track_count INTEGER,
  total_streams_cumulative BIGINT,
  missing_streams_track_count INTEGER,
  daily_streams_net BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (s.playlist_key)
    s.playlist_key,
    s.date,
    s.track_count,
    s.total_streams_cumulative,
    s.missing_streams_track_count,
    s.daily_streams_net
  FROM public.playlist_daily_stats s
  WHERE s.date <= p_as_of_date
  ORDER BY s.playlist_key, s.date DESC;
$$;

CREATE OR REPLACE FUNCTION public.catalog_membership_churn(
  p_window_days INT DEFAULT 7,
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  added_count INT,
  removed_count INT,
  net INT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH window_bounds AS (
    SELECT (p_as_of - (p_window_days || ' days')::interval)::date AS start_date
  ),
  scope AS (
    SELECT m.playlist_key, m.isrc, m.valid_from, m.valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key IN ('releases', 'ext')
  ),
  added AS (
    SELECT COUNT(*)::int AS n
    FROM scope m
    CROSS JOIN window_bounds w
    WHERE m.valid_from >= w.start_date
      AND m.valid_from <= p_as_of
  ),
  removed AS (
    SELECT COUNT(*)::int AS n
    FROM scope m
    CROSS JOIN window_bounds w
    WHERE m.valid_to IS NOT NULL
      AND m.valid_to >= w.start_date
      AND m.valid_to <= p_as_of
  )
  SELECT
    COALESCE((SELECT n FROM added), 0),
    COALESCE((SELECT n FROM removed), 0),
    COALESCE((SELECT n FROM added), 0) - COALESCE((SELECT n FROM removed), 0);
$$;

CREATE OR REPLACE FUNCTION public.catalog_active_isrcs(p_as_of DATE)
RETURNS TABLE (isrc TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT m.isrc
  FROM public.playlist_memberships m
  WHERE m.playlist_key IN ('releases', 'ext')
    AND m.valid_from <= p_as_of
    AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
    AND m.isrc IS NOT NULL
    AND btrim(m.isrc) <> '';
$$;

CREATE OR REPLACE FUNCTION competitor.own_catalog_overlap_matrix(p_as_of DATE)
RETURNS TABLE (
  competitor_label_key TEXT,
  shared_count INT,
  own_catalog_total INT,
  competitor_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH own_active AS (
    SELECT DISTINCT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND m.isrc IS NOT NULL
      AND btrim(m.isrc) <> ''
  ),
  competitor_active AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND m.isrc IS NOT NULL
      AND btrim(m.isrc) <> ''
  ),
  own_total AS (
    SELECT COUNT(*)::int AS n FROM own_active
  ),
  competitor_totals AS (
    SELECT label_key, COUNT(*)::int AS n
    FROM competitor_active
    GROUP BY label_key
  ),
  shared AS (
    SELECT ca.label_key, COUNT(*)::int AS n
    FROM competitor_active ca
    INNER JOIN own_active o ON o.isrc = ca.isrc
    GROUP BY ca.label_key
  )
  SELECT
    ct.label_key AS competitor_label_key,
    COALESCE(s.n, 0) AS shared_count,
    ot.n AS own_catalog_total,
    ct.n AS competitor_total,
    ROUND(
      COALESCE(s.n, 0)::numeric
        / NULLIF((ot.n + ct.n - COALESCE(s.n, 0))::numeric, 0),
      4
    ) AS jaccard
  FROM competitor_totals ct
  CROSS JOIN own_total ot
  LEFT JOIN shared s ON s.label_key = ct.label_key
  ORDER BY ct.label_key;
$$;

CREATE OR REPLACE FUNCTION competitor.own_catalog_overlap_artist_matrix(p_as_of DATE)
RETURNS TABLE (
  competitor_label_key TEXT,
  shared_count INT,
  own_catalog_total INT,
  competitor_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH own_active AS (
    SELECT DISTINCT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND m.isrc IS NOT NULL
      AND btrim(m.isrc) <> ''
  ),
  own_artists AS (
    SELECT DISTINCT btrim(u.aid) AS artist_id
    FROM own_active o
    JOIN public.tracks t ON t.isrc = o.isrc
    CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
    WHERE u.aid IS NOT NULL
      AND btrim(u.aid) <> ''
  ),
  competitor_artists AS (
    SELECT DISTINCT p.label_key, btrim(u.aid) AS artist_id
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    JOIN competitor.tracks t ON t.isrc = m.isrc
    CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND u.aid IS NOT NULL
      AND btrim(u.aid) <> ''
  ),
  own_total AS (
    SELECT COUNT(*)::int AS n FROM own_artists
  ),
  competitor_totals AS (
    SELECT label_key, COUNT(*)::int AS n
    FROM competitor_artists
    GROUP BY label_key
  ),
  shared AS (
    SELECT ca.label_key, COUNT(*)::int AS n
    FROM competitor_artists ca
    INNER JOIN own_artists o ON o.artist_id = ca.artist_id
    GROUP BY ca.label_key
  )
  SELECT
    ct.label_key AS competitor_label_key,
    COALESCE(s.n, 0) AS shared_count,
    ot.n AS own_catalog_total,
    ct.n AS competitor_total,
    ROUND(
      COALESCE(s.n, 0)::numeric
        / NULLIF((ot.n + ct.n - COALESCE(s.n, 0))::numeric, 0),
      4
    ) AS jaccard
  FROM competitor_totals ct
  CROSS JOIN own_total ot
  LEFT JOIN shared s ON s.label_key = ct.label_key
  ORDER BY ct.label_key;
$$;

CREATE OR REPLACE FUNCTION competitor.own_catalog_overlap_tracks(
  p_as_of DATE,
  p_competitor_label_key TEXT
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
  WITH own_active AS (
    SELECT DISTINCT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
  ),
  competitor_active AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_competitor_label_key
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
  ),
  shared AS (
    SELECT o.isrc
    FROM own_active o
    INNER JOIN competitor_active c ON c.isrc = o.isrc
  )
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names
  FROM shared s
  JOIN public.tracks t ON t.isrc = s.isrc
  ORDER BY name NULLS LAST, t.isrc;
$$;

CREATE OR REPLACE FUNCTION competitor.own_catalog_overlap_artists(
  p_as_of DATE,
  p_competitor_label_key TEXT
)
RETURNS TABLE (
  artist_id TEXT,
  artist_name TEXT,
  image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH own_active AS (
    SELECT DISTINCT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key IN ('releases', 'ext')
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND m.isrc IS NOT NULL
      AND btrim(m.isrc) <> ''
  ),
  competitor_active AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_competitor_label_key
      AND m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
      AND m.isrc IS NOT NULL
      AND btrim(m.isrc) <> ''
  ),
  own_artists AS (
    SELECT DISTINCT
      btrim(a.artist_id) AS artist_id,
      NULLIF(btrim(a.artist_name), '') AS artist_name
    FROM own_active o
    JOIN public.tracks t ON t.isrc = o.isrc
    CROSS JOIN LATERAL unnest(
      COALESCE(t.spotify_artist_ids, ARRAY[]::text[]),
      COALESCE(t.spotify_artist_names, ARRAY[]::text[])
    ) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  competitor_artists AS (
    SELECT DISTINCT
      btrim(a.artist_id) AS artist_id,
      NULLIF(btrim(a.artist_name), '') AS artist_name
    FROM competitor_active c
    JOIN competitor.tracks t ON t.isrc = c.isrc
    CROSS JOIN LATERAL unnest(
      COALESCE(t.spotify_artist_ids, ARRAY[]::text[]),
      COALESCE(t.spotify_artist_names, ARRAY[]::text[])
    ) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  shared AS (
    SELECT o.artist_id
    FROM own_artists o
    INNER JOIN competitor_artists c ON c.artist_id = o.artist_id
  ),
  names AS (
    SELECT
      s.artist_id,
      MAX(COALESCE(o.artist_name, c.artist_name)) AS artist_name
    FROM shared s
    LEFT JOIN own_artists o ON o.artist_id = s.artist_id
    LEFT JOIN competitor_artists c ON c.artist_id = s.artist_id
    GROUP BY s.artist_id
  )
  SELECT
    n.artist_id,
    COALESCE(n.artist_name, n.artist_id)::text AS artist_name,
    sai.image_url::text AS image_url
  FROM names n
  LEFT JOIN public.spotify_artist_images sai ON sai.artist_id = n.artist_id
  ORDER BY artist_name NULLS LAST, n.artist_id;
$$;

ALTER FUNCTION public.playlist_daily_stats_as_of(DATE) SET search_path = public;
ALTER FUNCTION public.catalog_membership_churn(INT, DATE) SET search_path = public;
ALTER FUNCTION public.catalog_active_isrcs(DATE) SET search_path = public;
ALTER FUNCTION competitor.own_catalog_overlap_matrix(DATE) SET search_path = competitor, public;
ALTER FUNCTION competitor.own_catalog_overlap_artist_matrix(DATE) SET search_path = competitor, public;
ALTER FUNCTION competitor.own_catalog_overlap_tracks(DATE, TEXT) SET search_path = competitor, public;
ALTER FUNCTION competitor.own_catalog_overlap_artists(DATE, TEXT) SET search_path = competitor, public;

GRANT EXECUTE ON FUNCTION public.playlist_daily_stats_as_of(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_membership_churn(INT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_active_isrcs(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.own_catalog_overlap_matrix(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.own_catalog_overlap_artist_matrix(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.own_catalog_overlap_tracks(DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.own_catalog_overlap_artists(DATE, TEXT) TO service_role;
