-- Competitive intelligence RPCs for /competitors (movers, churn, overlap).

CREATE OR REPLACE FUNCTION competitor.label_top_tracks_daily(
  p_run_date DATE,
  p_limit INT DEFAULT 20,
  p_direction TEXT DEFAULT 'gainers'
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  label_keys TEXT[],
  daily_delta BIGINT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH today AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams s
    WHERE s.date = p_run_date
  ),
  yday AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams s
    WHERE s.date = p_run_date - INTERVAL '1 day'
  ),
  active_membership AS (
    SELECT m.isrc, array_agg(DISTINCT p.label_key) AS label_keys
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
    GROUP BY m.isrc
  )
  SELECT
    ranked.isrc,
    ranked.name,
    ranked.album_image_url,
    ranked.artist_names,
    ranked.label_keys,
    ranked.daily_delta,
    ranked.total
  FROM (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url,
      t.spotify_artist_names::text[] AS artist_names,
      am.label_keys,
      (COALESCE(today.streams_cumulative, 0) - COALESCE(yday.streams_cumulative, 0))::bigint AS daily_delta,
      COALESCE(today.streams_cumulative, 0)::bigint AS total
    FROM competitor.tracks t
    JOIN active_membership am USING (isrc)
    LEFT JOIN today USING (isrc)
    LEFT JOIN yday USING (isrc)
    WHERE today.streams_cumulative IS NOT NULL
      AND yday.streams_cumulative IS NOT NULL
  ) ranked
  ORDER BY
    CASE WHEN lower(p_direction) = 'losers' THEN ranked.daily_delta END ASC NULLS LAST,
    CASE WHEN lower(p_direction) <> 'losers' THEN ranked.daily_delta END DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 20), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.label_membership_churn(
  p_window_days INT DEFAULT 7,
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  label_key TEXT,
  added_count INT,
  removed_count INT,
  net INT
)
LANGUAGE sql
STABLE
AS $$
  WITH window_bounds AS (
    SELECT (p_as_of - (p_window_days || ' days')::interval)::date AS start_date
  ),
  added AS (
    SELECT p.label_key, COUNT(*)::int AS added_count
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    CROSS JOIN window_bounds w
    WHERE m.valid_from >= w.start_date
      AND m.valid_from <= p_as_of
    GROUP BY p.label_key
  ),
  removed AS (
    SELECT p.label_key, COUNT(*)::int AS removed_count
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    CROSS JOIN window_bounds w
    WHERE m.valid_to IS NOT NULL
      AND m.valid_to >= w.start_date
      AND m.valid_to <= p_as_of
    GROUP BY p.label_key
  )
  SELECT
    l.label_key,
    COALESCE(a.added_count, 0),
    COALESCE(r.removed_count, 0),
    COALESCE(a.added_count, 0) - COALESCE(r.removed_count, 0)
  FROM competitor.labels l
  LEFT JOIN added a USING (label_key)
  LEFT JOIN removed r USING (label_key)
  ORDER BY l.display_name;
$$;

CREATE OR REPLACE FUNCTION competitor.label_overlap_matrix(
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  label_a TEXT,
  label_b TEXT,
  shared_isrcs INT,
  label_a_total INT,
  label_b_total INT,
  jaccard NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH active AS (
    SELECT DISTINCT p.label_key, m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE m.valid_from <= p_as_of
      AND (m.valid_to IS NULL OR m.valid_to >= p_as_of)
  ),
  totals AS (
    SELECT label_key, COUNT(*)::int AS n
    FROM active
    GROUP BY label_key
  )
  SELECT
    a.label_key AS label_a,
    b.label_key AS label_b,
    COUNT(*)::int AS shared_isrcs,
    ta.n AS label_a_total,
    tb.n AS label_b_total,
    ROUND(
      COUNT(*)::numeric / NULLIF((ta.n + tb.n - COUNT(*))::numeric, 0),
      4
    ) AS jaccard
  FROM active a
  JOIN active b ON a.isrc = b.isrc AND a.label_key < b.label_key
  JOIN totals ta ON ta.label_key = a.label_key
  JOIN totals tb ON tb.label_key = b.label_key
  GROUP BY a.label_key, b.label_key, ta.n, tb.n
  ORDER BY a.label_key, b.label_key;
$$;

ALTER FUNCTION competitor.label_top_tracks_daily(DATE, INT, TEXT) SET search_path = competitor, public;
ALTER FUNCTION competitor.label_membership_churn(INT, DATE) SET search_path = competitor, public;
ALTER FUNCTION competitor.label_overlap_matrix(DATE) SET search_path = competitor, public;

COMMENT ON FUNCTION competitor.label_top_tracks_daily(DATE, INT, TEXT) IS
  'Cross-label top daily stream gainers or losers at p_run_date.';

COMMENT ON FUNCTION competitor.label_membership_churn(INT, DATE) IS
  'Per-label playlist membership adds/removes/net over a window ending p_as_of.';

COMMENT ON FUNCTION competitor.label_overlap_matrix(DATE) IS
  'Pairwise Jaccard similarity of active competitor catalogs at p_as_of.';
