-- Migration: Add optional entity-playlist collector stats mode
--
-- Keeps existing collector assigned-playlist analytics as the default. When the
-- app passes p_use_entity_playlists = true, TG and PL are scoped to their Entity
-- playlists (`tg_total`, `p_total`) instead of their assigned Distro playlists.

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS collector_entity_playlist_stats_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_settings.collector_entity_playlist_stats_enabled IS
  'When enabled, /collectors scopes TG to tg_total and PL to p_total Entity playlists instead of assigned collector playlists.';

CREATE OR REPLACE VIEW public.collector_daily_agg_entity_playlists AS
WITH collector_scope AS (
  SELECT 'TG'::text AS collector, 'tg_total'::text AS playlist_key
  UNION ALL
  SELECT 'PL'::text AS collector, 'p_total'::text AS playlist_key
  UNION ALL
  SELECT upper(trim(p.collector)) AS collector, p.playlist_key
  FROM public.playlists p
  WHERE p.collector IS NOT NULL
    AND length(trim(p.collector)) > 0
    AND upper(trim(p.collector)) NOT IN ('TG', 'PL')
)
SELECT
  cs.collector,
  s.date,
  SUM(COALESCE(s.track_count, 0))::bigint AS track_count,
  SUM(COALESCE(s.total_streams_cumulative, 0))::bigint AS total_streams_cumulative,
  SUM(COALESCE(s.daily_streams_net, 0))::bigint AS daily_streams_net,
  SUM(COALESCE(s.est_revenue_total, 0))::numeric AS est_revenue_total,
  SUM(COALESCE(s.est_revenue_daily_net, 0))::numeric AS est_revenue_daily_net,
  SUM(COALESCE(s.missing_streams_track_count, 0))::bigint AS missing_streams_track_count
FROM collector_scope cs
JOIN public.playlist_daily_stats s
  ON s.playlist_key = cs.playlist_key
GROUP BY cs.collector, s.date;

COMMENT ON VIEW public.collector_daily_agg_entity_playlists IS
  'Daily collector aggregates where TG/PL use their Entity total playlists and other collectors use assigned playlists.';

CREATE OR REPLACE VIEW public.collector_daily_compare_entity_playlists AS
SELECT
  collector,
  date,
  track_count,
  total_streams_cumulative,
  daily_streams_net,
  est_revenue_total,
  est_revenue_daily_net,
  missing_streams_track_count,

  (daily_streams_net - LAG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date))::bigint
    AS daily_streams_delta_yday,
  (est_revenue_daily_net - LAG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date))::numeric
    AS est_revenue_daily_delta_yday,
  (track_count - LAG(track_count) OVER (PARTITION BY collector ORDER BY date))::bigint
    AS track_count_delta_yday,

  AVG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS daily_streams_ma7_prev,
  AVG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS est_revenue_daily_ma7_prev,
  AVG(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
    AS track_count_ma7_prev,

  (daily_streams_net - AVG(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::bigint
    AS daily_streams_delta_ma7,
  (est_revenue_daily_net - AVG(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::numeric
    AS est_revenue_daily_delta_ma7,
  (track_count - AVG(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING))::numeric
    AS track_count_delta_ma7
FROM public.collector_daily_agg_entity_playlists;

COMMENT ON VIEW public.collector_daily_compare_entity_playlists IS
  'Window comparison collector aggregates where TG/PL use Entity total playlists.';

CREATE OR REPLACE FUNCTION public.collector_effective_playlists(
  p_collector TEXT,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  playlist_key TEXT,
  playlist_type TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT p.playlist_key::text, p.playlist_type::text
  FROM public.playlists p
  WHERE
    CASE
      WHEN COALESCE($2, false) AND upper(coalesce($1, '')) = 'TG' THEN p.playlist_key = 'tg_total'
      WHEN COALESCE($2, false) AND upper(coalesce($1, '')) = 'PL' THEN p.playlist_key = 'p_total'
      ELSE upper(coalesce(p.collector, '')) = upper(coalesce($1, ''))
    END;
$$;

CREATE OR REPLACE FUNCTION public.collector_artist_counts_for_date_scoped(
  run_date DATE,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  collector TEXT,
  artist_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH
    collectors AS (
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
    active_members AS (
      SELECT cp.collector, m.isrc
      FROM public.playlist_memberships m
      INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
      WHERE m.valid_from <= $1
        AND (m.valid_to IS NULL OR m.valid_to >= $1)
    ),
    per_isrc AS (
      SELECT am.collector, am.isrc
      FROM active_members am
      GROUP BY am.collector, am.isrc
    ),
    artist_ids AS (
      SELECT p.collector, a.artist_id
      FROM per_isrc p
      INNER JOIN public.tracks t ON t.isrc = p.isrc
      CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
      WHERE t.spotify_artist_ids IS NOT NULL
        AND a.artist_id IS NOT NULL
        AND length(a.artist_id) > 0
    ),
    counts AS (
      SELECT collector, COUNT(DISTINCT artist_id)::bigint AS artist_count
      FROM artist_ids
      GROUP BY collector
    )
  SELECT c.collector, COALESCE(cnt.artist_count, 0)::bigint AS artist_count
  FROM collectors c
  LEFT JOIN counts cnt USING (collector)
  ORDER BY c.collector;
$$;

CREATE OR REPLACE FUNCTION public.collector_tracks_paged_scoped(
  collector TEXT,
  run_date DATE,
  prev_date DATE DEFAULT NULL,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 1000,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
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
    SELECT ep.playlist_key, ep.playlist_type
    FROM public.collector_effective_playlists($1, $6) ep
  ),
  active_members AS (
    SELECT m.isrc, m.playlist_key
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

CREATE OR REPLACE FUNCTION public.collector_artists_stats_paged_scoped(
  collector TEXT,
  run_date DATE,
  offset_rows INT DEFAULT 0,
  limit_rows INT DEFAULT 200,
  p_use_entity_playlists BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  artist_id TEXT,
  name TEXT,
  image_url TEXT,
  track_count BIGINT,
  total_streams_cumulative BIGINT,
  daily_streams_delta BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH collector_playlists AS (
    SELECT ep.playlist_key
    FROM public.collector_effective_playlists($1, $5) ep
  ),
  active_members AS (
    SELECT m.isrc
    FROM public.playlist_memberships m
    INNER JOIN collector_playlists cp ON cp.playlist_key = m.playlist_key
    WHERE m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ),
  per_isrc AS (
    SELECT am.isrc
    FROM active_members am
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
    WHERE s.date = ($2 - INTERVAL '1 day')::date
  ),
  per_artist AS (
    SELECT
      a.artist_id::text AS artist_id,
      MAX(COALESCE(ai.name, t.spotify_artist_names[a.idx]))::text AS name,
      MAX(ai.image_url)::text AS image_url,
      COUNT(DISTINCT p.isrc)::bigint AS track_count,
      SUM(COALESCE(td.streams_cumulative, 0))::bigint AS total_streams_cumulative,
      SUM(
        CASE
          WHEN td.streams_cumulative IS NULL OR pv.streams_cumulative IS NULL THEN 0
          ELSE (td.streams_cumulative - pv.streams_cumulative)
        END
      )::bigint AS daily_streams_delta
    FROM per_isrc p
    INNER JOIN public.tracks t ON t.isrc = p.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) WITH ORDINALITY AS a(artist_id, idx)
    LEFT JOIN public.spotify_artist_images ai ON ai.artist_id = a.artist_id
    LEFT JOIN today td ON td.isrc = p.isrc
    LEFT JOIN prev pv ON pv.isrc = p.isrc
    WHERE t.spotify_artist_ids IS NOT NULL
      AND a.artist_id IS NOT NULL
      AND length(a.artist_id) > 0
    GROUP BY a.artist_id
  )
  SELECT
    pa.artist_id,
    pa.name,
    pa.image_url,
    pa.track_count,
    pa.total_streams_cumulative,
    pa.daily_streams_delta
  FROM per_artist pa
  ORDER BY pa.daily_streams_delta DESC, pa.total_streams_cumulative DESC, lower(coalesce(pa.name, '')) ASC, pa.artist_id ASC
  OFFSET GREATEST(COALESCE($3, 0), 0)
  LIMIT GREATEST(LEAST(COALESCE($4, 200), 1000), 0);
$$;

GRANT SELECT ON public.collector_daily_agg_entity_playlists TO anon, authenticated;
GRANT SELECT ON public.collector_daily_compare_entity_playlists TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_effective_playlists(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_artist_counts_for_date_scoped(DATE, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_tracks_paged_scoped(TEXT, DATE, DATE, INT, INT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collector_artists_stats_paged_scoped(TEXT, DATE, INT, INT, BOOLEAN) TO anon, authenticated;
