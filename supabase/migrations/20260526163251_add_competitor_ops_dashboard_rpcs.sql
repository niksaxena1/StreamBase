-- Efficient reads for /competitors ops dashboard (latest snapshots only).

CREATE OR REPLACE FUNCTION competitor.latest_raw_exports_by_playlist()
RETURNS TABLE (
  playlist_key TEXT,
  rows_count INTEGER,
  exported_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT ON (e.playlist_key)
    e.playlist_key,
    e.rows_count,
    e.exported_at
  FROM competitor.raw_exports e
  ORDER BY e.playlist_key, e.exported_at DESC;
$$;

CREATE OR REPLACE FUNCTION competitor.playlist_daily_stats_last_two()
RETURNS TABLE (
  playlist_key TEXT,
  snapshot_rank INTEGER,
  date DATE,
  track_count INTEGER,
  total_streams_cumulative BIGINT,
  missing_streams_track_count INTEGER,
  daily_streams_net BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    ranked.playlist_key,
    ranked.snapshot_rank::integer,
    ranked.date,
    ranked.track_count,
    ranked.total_streams_cumulative,
    ranked.missing_streams_track_count,
    ranked.daily_streams_net
  FROM (
    SELECT
      s.playlist_key,
      s.date,
      s.track_count,
      s.total_streams_cumulative,
      s.missing_streams_track_count,
      s.daily_streams_net,
      ROW_NUMBER() OVER (PARTITION BY s.playlist_key ORDER BY s.date DESC) AS snapshot_rank
    FROM competitor.playlist_daily_stats s
  ) ranked
  WHERE ranked.snapshot_rank <= 2;
$$;

CREATE OR REPLACE FUNCTION competitor.label_distinct_artist_counts(p_run_date DATE)
RETURNS TABLE (label_key TEXT, artist_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    pl.label_key,
    COUNT(DISTINCT btrim(u.aid))::bigint AS artist_count
  FROM competitor.playlist_memberships m
  INNER JOIN competitor.playlists pl ON pl.playlist_key = m.playlist_key
  INNER JOIN competitor.tracks t ON t.isrc = m.isrc
  CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
  WHERE m.valid_from <= p_run_date
    AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
    AND u.aid IS NOT NULL
    AND btrim(u.aid) <> ''
  GROUP BY pl.label_key;
$$;

COMMENT ON FUNCTION competitor.latest_raw_exports_by_playlist() IS
  'Latest raw export row per competitor playlist (ops dashboard).';

COMMENT ON FUNCTION competitor.playlist_daily_stats_last_two() IS
  'Latest two daily stat snapshots per competitor playlist for day-over-day ops deltas.';

COMMENT ON FUNCTION competitor.label_distinct_artist_counts(DATE) IS
  'Distinct Spotify artist IDs on active competitor tracks, grouped by label, at run_date.';

CREATE OR REPLACE FUNCTION competitor.playlist_daily_stats_as_of(p_as_of_date DATE)
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
SET search_path = ''
AS $$
  SELECT DISTINCT ON (s.playlist_key)
    s.playlist_key,
    s.date,
    s.track_count,
    s.total_streams_cumulative,
    s.missing_streams_track_count,
    s.daily_streams_net
  FROM competitor.playlist_daily_stats s
  WHERE s.date <= p_as_of_date
  ORDER BY s.playlist_key, s.date DESC;
$$;

COMMENT ON FUNCTION competitor.playlist_daily_stats_as_of(DATE) IS
  'Latest playlist_daily_stats row per playlist on or before as-of run_date (weekly ops deltas).';
