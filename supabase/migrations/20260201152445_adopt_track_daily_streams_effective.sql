-- Migration: Adopt track_daily_streams_effective for RPCs
-- Run this in your Supabase SQL editor AFTER:
--   - `migrations/add_track_daily_stream_overrides.sql`
--
-- Goal:
-- - Ensure key RPCs and health queries incorporate manual stream overrides.

-- 1) Fast search hover stats (/api/search-stats)
CREATE OR REPLACE FUNCTION public.artist_total_streams_for_date(
  artist_id TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.tracks t
  JOIN public.track_daily_streams_effective_public s
    ON s.isrc = t.isrc
   AND s.date = $2
  WHERE t.spotify_artist_ids @> ARRAY[$1]::text[];
$$;

CREATE OR REPLACE FUNCTION public.playlist_total_streams_for_date(
  playlist_key TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.playlist_memberships m
  JOIN public.track_daily_streams_effective_public s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_to IS NULL;
$$;

-- 2) Catalog artist aggregates (/catalog)
CREATE OR REPLACE FUNCTION public.catalog_artist_series(
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
AS $$
  WITH artist_isrcs AS (
    SELECT t.isrc
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  )
  SELECT
    s.date,
    SUM(COALESCE(s.streams_cumulative, 0))::bigint AS streams_cumulative
  FROM public.track_daily_streams_effective_public s
  JOIN artist_isrcs a USING (isrc)
  WHERE s.date >= start_date
    AND s.date <= end_date
  GROUP BY s.date
  ORDER BY s.date ASC;
$$;

CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_total(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_tracks AS (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    GREATEST(0, t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$$;

CREATE OR REPLACE FUNCTION public.catalog_artist_top_tracks_daily(
  artist_id TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH artist_tracks AS (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url
    FROM public.tracks t
    WHERE t.spotify_artist_ids @> ARRAY[artist_id]::text[]
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = run_date
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = (run_date - INTERVAL '1 day')::date
  )
  SELECT
    at.isrc,
    at.name,
    at.album_image_url,
    t.streams_cumulative AS total,
    GREATEST(0, t.streams_cumulative - COALESCE(p.streams_cumulative, 0))::bigint AS daily
  FROM artist_tracks at
  JOIN today t USING (isrc)
  LEFT JOIN prev p USING (isrc)
  ORDER BY daily DESC, total DESC, at.name ASC
  LIMIT GREATEST(COALESCE(limit_rows, 25), 0);
$$;

-- 3) Health missing catalog calculations (/health drilldowns)
CREATE OR REPLACE FUNCTION public.health_playlist_missing_catalog_tracks(
  playlist_key TEXT,
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH active_members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  catalog_isrcs AS (
    SELECT s.isrc
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  excluded_nc AS (
    SELECT e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
      AND (e.playlist_key IS NULL OR e.playlist_key = $1)
  ),
  excluded_unplayable AS (
    SELECT e.isrc
    FROM public.health_unplayable_track_exclusions e
    WHERE (e.playlist_key IS NULL OR e.playlist_key = $1)
  ),
  missing AS (
    SELECT am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded_nc ex_nc ON ex_nc.isrc = am.isrc
    LEFT JOIN excluded_unplayable ex_up ON ex_up.isrc = am.isrc
    WHERE c.isrc IS NULL
      AND ex_nc.isrc IS NULL
      AND ex_up.isrc IS NULL
  )
  SELECT
    m.isrc,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM missing m
  LEFT JOIN public.tracks t USING (isrc)
  ORDER BY COALESCE(t.name, m.isrc) ASC;
$$;

CREATE OR REPLACE FUNCTION public.health_missing_catalog_tracks(
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  playlist_keys TEXT[],
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH active_members AS (
    SELECT m.playlist_key, m.isrc
    FROM public.playlist_memberships m
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  catalog_isrcs AS (
    SELECT s.isrc
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $1
  ),
  excluded_nc AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
  ),
  excluded_unplayable AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_unplayable_track_exclusions e
  ),
  missing AS (
    SELECT am.playlist_key, am.isrc
    FROM active_members am
    LEFT JOIN catalog_isrcs c ON c.isrc = am.isrc
    LEFT JOIN excluded_nc ex_global_nc ON ex_global_nc.isrc = am.isrc AND ex_global_nc.playlist_key IS NULL
    LEFT JOIN excluded_nc ex_pl_nc ON ex_pl_nc.isrc = am.isrc AND ex_pl_nc.playlist_key = am.playlist_key
    LEFT JOIN excluded_unplayable ex_global_up ON ex_global_up.isrc = am.isrc AND ex_global_up.playlist_key IS NULL
    LEFT JOIN excluded_unplayable ex_pl_up ON ex_pl_up.isrc = am.isrc AND ex_pl_up.playlist_key = am.playlist_key
    WHERE c.isrc IS NULL
      AND ex_global_nc.isrc IS NULL
      AND ex_pl_nc.isrc IS NULL
      AND ex_global_up.isrc IS NULL
      AND ex_pl_up.isrc IS NULL
  )
  SELECT
    m.isrc,
    array_agg(DISTINCT m.playlist_key ORDER BY m.playlist_key) AS playlist_keys,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url
  FROM missing m
  LEFT JOIN public.tracks t USING (isrc)
  GROUP BY m.isrc, t.name, t.spotify_artist_names, t.spotify_artist_ids, t.spotify_album_image_url
  ORDER BY COALESCE(t.name, m.isrc) ASC;
$$;

-- 3b) Unplayable/taken-down candidates (incorporate effective streams for "present today" checks)
CREATE OR REPLACE FUNCTION public.health_unplayable_candidates(
  run_date DATE,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  playlist_keys TEXT[],
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT,
  first_catalog_date DATE,
  last_catalog_date DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH active_members AS (
    SELECT m.playlist_key, m.isrc
    FROM public.playlist_memberships m
    WHERE m.valid_from <= $1
      AND (m.valid_to IS NULL OR m.valid_to >= $1)
  ),
  catalog_today AS (
    SELECT s.isrc
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $1
  ),
  excluded_non_catalog AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_warning_exclusions e
    WHERE e.code = 'non_catalog_tracks_present'
  ),
  excluded_unplayable AS (
    SELECT e.playlist_key, e.isrc
    FROM public.health_unplayable_track_exclusions e
  ),
  missing_today AS (
    SELECT am.playlist_key, am.isrc
    FROM active_members am
    LEFT JOIN catalog_today ct ON ct.isrc = am.isrc
    LEFT JOIN excluded_non_catalog ex_global_nc
      ON ex_global_nc.isrc = am.isrc AND ex_global_nc.playlist_key IS NULL
    LEFT JOIN excluded_non_catalog ex_pl_nc
      ON ex_pl_nc.isrc = am.isrc AND ex_pl_nc.playlist_key = am.playlist_key
    LEFT JOIN excluded_unplayable ex_global_up
      ON ex_global_up.isrc = am.isrc AND ex_global_up.playlist_key IS NULL
    LEFT JOIN excluded_unplayable ex_pl_up
      ON ex_pl_up.isrc = am.isrc AND ex_pl_up.playlist_key = am.playlist_key
    WHERE ct.isrc IS NULL
      AND ex_global_nc.isrc IS NULL
      AND ex_pl_nc.isrc IS NULL
      AND ex_global_up.isrc IS NULL
      AND ex_pl_up.isrc IS NULL
  ),
  catalog_history AS (
    SELECT s.isrc, MIN(s.date) AS first_catalog_date, MAX(s.date) AS last_catalog_date
    FROM public.track_daily_streams_effective_public s
    WHERE s.date < $1
    GROUP BY s.isrc
  ),
  candidates AS (
    SELECT m.isrc
    FROM missing_today m
    JOIN catalog_history h ON h.isrc = m.isrc
    GROUP BY m.isrc
  )
  SELECT
    m.isrc,
    array_agg(DISTINCT m.playlist_key ORDER BY m.playlist_key) AS playlist_keys,
    t.name::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url,
    h.first_catalog_date,
    h.last_catalog_date
  FROM missing_today m
  -- IMPORTANT: use USING here to avoid duplicate `isrc` columns (which breaks later USING joins)
  JOIN candidates c USING (isrc)
  LEFT JOIN public.tracks t ON t.isrc = m.isrc
  LEFT JOIN catalog_history h ON h.isrc = m.isrc
  GROUP BY m.isrc, t.name, t.spotify_artist_names, t.spotify_artist_ids, t.spotify_album_image_url, h.first_catalog_date, h.last_catalog_date
  ORDER BY h.last_catalog_date DESC NULLS LAST, COALESCE(t.name, m.isrc) ASC
  LIMIT GREATEST(1, LEAST($2, 2000));
$$;

-- 4) Playlists + collectors heavy RPCs
CREATE OR REPLACE FUNCTION public.playlist_top_tracks(
  playlist_key TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT,
  daily BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH memberships_union AS (
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1

    UNION ALL
    SELECT m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
    FROM public.playlist_memberships m
    WHERE $1 = 'all_catalog'
      AND m.playlist_key IN ('releases', 'ext')
  ),
  memberships AS (
    SELECT
      u.isrc,
      MIN(u.valid_from) AS valid_from,
      CASE
        WHEN BOOL_OR(u.valid_to IS NULL) THEN NULL
        ELSE MAX(u.valid_to)
      END AS valid_to
    FROM memberships_union u
    GROUP BY u.isrc
  ),
  current_members AS (
    SELECT isrc, valid_from
    FROM memberships
    WHERE valid_to IS NULL
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE $3 IS NOT NULL
      AND s.date = $3
  )
  SELECT
    cm.isrc,
    COALESCE(t.name, cm.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    cm.valid_from::date AS valid_from,
    td.streams_cumulative AS total,
    CASE
      WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN NULL
      ELSE GREATEST(0, td.streams_cumulative - pv.streams_cumulative)::bigint
    END AS daily
  FROM current_members cm
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN today td USING (isrc)
  LEFT JOIN prev pv USING (isrc)
  ORDER BY daily DESC NULLS LAST, total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($4, 200), 0);
$$;

CREATE OR REPLACE FUNCTION public.collector_tracks(
  collector TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  limit_rows INT DEFAULT 5000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  playlist_keys TEXT[],
  distro_playlist_keys TEXT[],
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH collector_playlists AS (
    SELECT p.playlist_key, p.playlist_type
    FROM public.playlists p
    WHERE upper(coalesce(p.collector, '')) = upper(coalesce($1, ''))
  ),
  active_members AS (
    SELECT
      m.isrc,
      m.playlist_key
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  per_isrc AS (
    SELECT
      am.isrc,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key) AS playlist_keys,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key)
        FILTER (WHERE cp.playlist_type = 'Distro') AS distro_playlist_keys
    FROM active_members am
    INNER JOIN collector_playlists cp ON cp.playlist_key = am.playlist_key
    GROUP BY am.isrc
  ),
  today AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE $3 IS NOT NULL
      AND s.date = $3
  )
  SELECT
    p.isrc,
    COALESCE(t.name, p.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    COALESCE(p.playlist_keys, ARRAY[]::text[]) AS playlist_keys,
    COALESCE(p.distro_playlist_keys, ARRAY[]::text[]) AS distro_playlist_keys,
    COALESCE(td.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN NULL
      ELSE (td.streams_cumulative - pv.streams_cumulative)::bigint
    END AS daily_streams_delta
  FROM per_isrc p
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN today td USING (isrc)
  LEFT JOIN prev pv USING (isrc)
  ORDER BY daily_streams_delta DESC NULLS LAST, total_streams_cumulative DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($4, 5000), 0);
$$;

CREATE OR REPLACE FUNCTION public.collector_tracks_paged(
  collector TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 1000
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  playlist_keys TEXT[],
  distro_playlist_keys TEXT[],
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH collector_playlists AS (
    SELECT p.playlist_key, p.playlist_type
    FROM public.playlists p
    WHERE upper(coalesce(p.collector, '')) = upper(coalesce($1, ''))
  ),
  active_members AS (
    SELECT
      m.isrc,
      m.playlist_key
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  per_isrc AS (
    SELECT
      am.isrc,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key) AS playlist_keys,
      array_agg(DISTINCT am.playlist_key ORDER BY am.playlist_key)
        FILTER (WHERE cp.playlist_type = 'Distro') AS distro_playlist_keys
    FROM active_members am
    INNER JOIN collector_playlists cp ON cp.playlist_key = am.playlist_key
    GROUP BY am.isrc
  ),
  today AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  ),
  prev AS (
    SELECT s.isrc, s.streams_cumulative::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    WHERE $3 IS NOT NULL
      AND s.date = $3
  )
  SELECT
    p.isrc,
    COALESCE(t.name, p.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    COALESCE(p.playlist_keys, ARRAY[]::text[]) AS playlist_keys,
    COALESCE(p.distro_playlist_keys, ARRAY[]::text[]) AS distro_playlist_keys,
    COALESCE(td.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN NULL
      ELSE (td.streams_cumulative - pv.streams_cumulative)::bigint
    END AS daily_streams_delta
  FROM per_isrc p
  LEFT JOIN public.tracks t USING (isrc)
  LEFT JOIN today td USING (isrc)
  LEFT JOIN prev pv USING (isrc)
  ORDER BY daily_streams_delta DESC NULLS LAST, total_streams_cumulative DESC NULLS LAST, name ASC
  OFFSET GREATEST(COALESCE($4, 0), 0)
  LIMIT GREATEST(LEAST(COALESCE($5, 1000), 1000), 0);
$$;

-- 5) SAI track/playlist primitives
CREATE OR REPLACE FUNCTION public.track_total_streams_for_date(
  isrc TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.track_daily_streams_effective_public s
  WHERE s.isrc = $1
    AND s.date = $2;
$$;

CREATE OR REPLACE FUNCTION public.track_series(
  isrc TEXT,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE (
  date DATE,
  streams_cumulative BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.date,
    COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
  FROM public.track_daily_streams_effective_public s
  WHERE s.isrc = $1
    AND s.date >= $2
    AND s.date <= $3
  ORDER BY s.date ASC;
$$;

CREATE OR REPLACE FUNCTION public.playlist_top_tracks_total(
  playlist_key TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 25
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    WHERE m.playlist_key = $1
      AND m.valid_to IS NULL
  ),
  today AS (
    SELECT s.isrc, COALESCE(s.streams_cumulative, 0)::bigint AS total
    FROM public.track_daily_streams_effective_public s
    WHERE s.date = $2
  )
  SELECT
    t.isrc,
    COALESCE(tr.name, t.isrc)::text AS name,
    tr.spotify_album_image_url::text AS album_image_url,
    t.total
  FROM members m
  JOIN today t ON t.isrc = m.isrc
  LEFT JOIN public.tracks tr ON tr.isrc = t.isrc
  ORDER BY t.total DESC, name ASC
  LIMIT LEAST(GREATEST(COALESCE($3, 25), 0), 100);
$$;

-- Re-affirm public EXECUTE grants (harmless if already granted).
GRANT EXECUTE ON FUNCTION public.artist_total_streams_for_date(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playlist_total_streams_for_date(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_artist_series(TEXT, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_total(TEXT, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_artist_top_tracks_daily(TEXT, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_playlist_missing_catalog_tracks(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_missing_catalog_tracks(DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_unplayable_candidates(DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playlist_top_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_tracks(TEXT, DATE, DATE, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_tracks_paged(TEXT, DATE, DATE, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_total_streams_for_date(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_series(TEXT, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playlist_top_tracks_total(TEXT, DATE, INT) TO anon, authenticated;

