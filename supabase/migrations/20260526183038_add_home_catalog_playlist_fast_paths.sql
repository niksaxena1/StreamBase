-- Fast-path summaries for the highest-traffic dashboard pages.
--
-- Goals:
-- - Keep raw stream snapshots as the source of truth.
-- - Add small artist/day summaries for Catalog charts.
-- - Add a single Playlist summary RPC that replaces multiple page-time calls.
-- - Mirror Catalog summaries into competitor schema without mixing universes.

CREATE TABLE IF NOT EXISTS public.artist_daily_stats (
  date DATE NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT,
  streams_cumulative BIGINT NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, artist_id)
);

CREATE INDEX IF NOT EXISTS artist_daily_stats_artist_date_idx
  ON public.artist_daily_stats (artist_id, date DESC);

CREATE OR REPLACE FUNCTION public.refresh_artist_daily_stats(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  DELETE FROM public.artist_daily_stats s
  WHERE (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date);

  INSERT INTO public.artist_daily_stats (
    date,
    artist_id,
    artist_name,
    streams_cumulative,
    track_count,
    updated_at
  )
  SELECT
    s.date,
    a.artist_id,
    MAX(NULLIF(a.artist_name, '')) AS artist_name,
    SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative,
    COUNT(DISTINCT t.isrc)::integer AS track_count,
    NOW() AS updated_at
  FROM public.track_daily_streams s
  JOIN public.tracks t USING (isrc)
  CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
  WHERE a.artist_id IS NOT NULL
    AND btrim(a.artist_id) <> ''
    AND (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date)
  GROUP BY s.date, a.artist_id;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_artist_series_fast(
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
SET search_path = ''
AS $$
  WITH summary_rows AS (
    SELECT s.date, s.streams_cumulative
    FROM public.artist_daily_stats s
    WHERE s.artist_id = $1
      AND s.date BETWEEN $2 AND $3
  ),
  missing_dates AS (
    SELECT gs.d::date AS date
    FROM generate_series($2, $3, INTERVAL '1 day') AS gs(d)
    WHERE NOT EXISTS (
      SELECT 1
      FROM summary_rows sr
      WHERE sr.date = gs.d::date
    )
  ),
  artist_isrcs AS (
    SELECT t.isrc
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[$1]::text[]
  ),
  raw_rows AS (
    SELECT
      s.date,
      SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative
    FROM public.track_daily_streams s
    JOIN missing_dates md ON md.date = s.date
    JOIN artist_isrcs a USING (isrc)
    GROUP BY s.date
  )
  SELECT summary_rows.date, summary_rows.streams_cumulative FROM summary_rows
  UNION ALL
  SELECT raw_rows.date, raw_rows.streams_cumulative FROM raw_rows
  ORDER BY 1 ASC;
$$;

CREATE OR REPLACE FUNCTION public.playlist_dashboard_summary(
  playlist_key TEXT,
  as_of_date DATE DEFAULT NULL
)
RETURNS TABLE (
  latest_date DATE,
  prev_date DATE,
  track_count INTEGER,
  total_streams_cumulative BIGINT,
  daily_streams_net BIGINT,
  est_revenue_total NUMERIC,
  est_revenue_daily_net NUMERIC,
  distinct_artist_count BIGINT,
  removed_tracks_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH ranked_stats AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (ORDER BY s.date DESC) AS snapshot_rank
    FROM public.playlist_daily_stats s
    WHERE s.playlist_key = $1
      AND ($2 IS NULL OR s.date <= $2)
  ),
  latest AS (
    SELECT * FROM ranked_stats WHERE snapshot_rank = 1
  ),
  prev AS (
    SELECT * FROM ranked_stats WHERE snapshot_rank = 2
  ),
  active_members AS (
    SELECT DISTINCT m.isrc
    FROM public.playlist_memberships m
    CROSS JOIN latest l
    WHERE (
      ($1 <> 'all_catalog' AND m.playlist_key = $1)
      OR ($1 = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
    )
      AND m.valid_from <= l.date
      AND (m.valid_to IS NULL OR m.valid_to >= l.date)
  ),
  artist_count AS (
    SELECT COUNT(DISTINCT btrim(a.artist_id))::bigint AS n
    FROM active_members m
    JOIN public.tracks t USING (isrc)
    CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS a(artist_id)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  removed_count AS (
    SELECT LEAST(COUNT(DISTINCT m.isrc), 500)::bigint AS n
    FROM public.playlist_memberships m
    WHERE (
      ($1 <> 'all_catalog' AND m.playlist_key = $1)
      OR ($1 = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
    )
      AND m.valid_to IS NOT NULL
  )
  SELECT
    l.date,
    p.date,
    l.track_count,
    l.total_streams_cumulative,
    l.daily_streams_net,
    l.est_revenue_total,
    l.est_revenue_daily_net,
    COALESCE((SELECT n FROM artist_count), 0::bigint),
    COALESCE((SELECT n FROM removed_count), 0::bigint)
  FROM latest l
  LEFT JOIN prev p ON TRUE;
$$;

CREATE TABLE IF NOT EXISTS competitor.artist_daily_stats (
  date DATE NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT,
  streams_cumulative BIGINT NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, artist_id)
);

CREATE INDEX IF NOT EXISTS competitor_artist_daily_stats_artist_date_idx
  ON competitor.artist_daily_stats (artist_id, date DESC);

CREATE OR REPLACE FUNCTION competitor.refresh_artist_daily_stats(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  DELETE FROM competitor.artist_daily_stats s
  WHERE (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date);

  INSERT INTO competitor.artist_daily_stats (
    date,
    artist_id,
    artist_name,
    streams_cumulative,
    track_count,
    updated_at
  )
  SELECT
    s.date,
    a.artist_id,
    MAX(NULLIF(a.artist_name, '')) AS artist_name,
    SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative,
    COUNT(DISTINCT t.isrc)::integer AS track_count,
    NOW() AS updated_at
  FROM competitor.track_daily_streams s
  JOIN competitor.tracks t USING (isrc)
  CROSS JOIN LATERAL unnest(t.spotify_artist_ids, t.spotify_artist_names) AS a(artist_id, artist_name)
  WHERE a.artist_id IS NOT NULL
    AND btrim(a.artist_id) <> ''
    AND (p_start_date IS NULL OR s.date >= p_start_date)
    AND (p_end_date IS NULL OR s.date <= p_end_date)
  GROUP BY s.date, a.artist_id;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_series_fast(
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
SET search_path = ''
AS $$
  WITH summary_rows AS (
    SELECT s.date, s.streams_cumulative
    FROM competitor.artist_daily_stats s
    WHERE s.artist_id = $1
      AND s.date BETWEEN $2 AND $3
  ),
  missing_dates AS (
    SELECT gs.d::date AS date
    FROM generate_series($2, $3, INTERVAL '1 day') AS gs(d)
    WHERE NOT EXISTS (
      SELECT 1
      FROM summary_rows sr
      WHERE sr.date = gs.d::date
    )
  ),
  artist_isrcs AS (
    SELECT t.isrc
    FROM competitor.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[$1]::text[]
  ),
  raw_rows AS (
    SELECT
      s.date,
      SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative
    FROM competitor.track_daily_streams s
    JOIN missing_dates md ON md.date = s.date
    JOIN artist_isrcs a USING (isrc)
    GROUP BY s.date
  )
  SELECT summary_rows.date, summary_rows.streams_cumulative FROM summary_rows
  UNION ALL
  SELECT raw_rows.date, raw_rows.streams_cumulative FROM raw_rows
  ORDER BY 1 ASC;
$$;

COMMENT ON TABLE public.artist_daily_stats IS
  'Small Catalog fast-path summary. Refresh after stream ingestion; raw track_daily_streams remains source of truth.';
COMMENT ON TABLE competitor.artist_daily_stats IS
  'Competitor Catalog fast-path summary. Refresh after competitor stream ingestion; stays isolated in competitor schema.';
COMMENT ON FUNCTION public.playlist_dashboard_summary(TEXT, DATE) IS
  'Single-call Playlists dashboard metrics for latest snapshot, previous snapshot date, artist count, and capped removed count.';
