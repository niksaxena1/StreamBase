-- Exclude Saturday/Sunday spike rows by default, with a boolean parameter to include them.

INSERT INTO public.health_config (key, value_numeric, description) VALUES
  (
    'artificial_streams_include_weekends',
    0,
    'Whether artificial stream spike detection should include Saturday and Sunday rows (default 0 = weekdays only).'
  )
ON CONFLICT (key) DO NOTHING;

-- Remove 4-arg overload so RPC resolves to the 5-arg function with default p_include_weekends.
DROP FUNCTION IF EXISTS public.home_artificial_stream_spikes(numeric, numeric, integer, bigint);

CREATE OR REPLACE FUNCTION public.home_artificial_stream_spikes(
  p_spike_ratio numeric DEFAULT 1.25,
  p_min_baseline numeric DEFAULT 50,
  p_grace_days integer DEFAULT 14,
  p_threshold_crossing_max bigint DEFAULT 1500,
  p_include_weekends boolean DEFAULT false
)
RETURNS TABLE(
  isrc text,
  name text,
  artist_names text[],
  artist_ids text[],
  album_image_url text,
  date date,
  daily_streams bigint,
  avg_same_dow numeric,
  spike_ratio numeric,
  streams_cumulative bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH seq AS (
    SELECT
      tds.isrc,
      tds.date::date AS d,
      tds.streams_cumulative,
      LAG(tds.streams_cumulative) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_cum,
      LAG(tds.date) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_date
    FROM public.track_daily_streams_effective_public tds
  ),
  daily AS (
    SELECT
      s.isrc,
      s.d AS date,
      s.streams_cumulative,
      s.prev_cum,
      (s.streams_cumulative - s.prev_cum)::bigint AS daily_streams
    FROM seq s
    WHERE s.prev_date IS NOT NULL
      AND s.prev_date = (s.d - INTERVAL '1 day')::date
      AND s.streams_cumulative > s.prev_cum
      AND (s.streams_cumulative - s.prev_cum) > 0
  ),
  with_stats AS (
    SELECT
      d.isrc,
      d.date,
      d.streams_cumulative,
      d.prev_cum,
      d.daily_streams,
      MIN(d.date) OVER (
        PARTITION BY d.isrc
      ) AS first_observed_date,
      EXTRACT(DOW FROM d.date)::integer AS dow,
      AVG(d.daily_streams::numeric) OVER (
        PARTITION BY d.isrc, EXTRACT(DOW FROM d.date)
        ORDER BY d.date
        ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
      ) AS avg_same_dow,
      COUNT(*) OVER (
        PARTITION BY d.isrc, EXTRACT(DOW FROM d.date)
        ORDER BY d.date
        ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING
      ) AS prior_sample_count
    FROM daily d
  )
  SELECT
    tr.isrc,
    COALESCE(tr.name, tr.isrc)::text AS name,
    tr.spotify_artist_names::text[] AS artist_names,
    tr.spotify_artist_ids::text[] AS artist_ids,
    tr.spotify_album_image_url::text AS album_image_url,
    ws.date,
    ws.daily_streams,
    ws.avg_same_dow,
    (ws.daily_streams::numeric / NULLIF(ws.avg_same_dow, 0)) AS spike_ratio,
    ws.streams_cumulative::bigint AS streams_cumulative
  FROM with_stats ws
  JOIN public.tracks tr ON tr.isrc = ws.isrc
  WHERE ws.avg_same_dow IS NOT NULL
    AND ws.avg_same_dow >= p_min_baseline
    AND ws.prior_sample_count >= 2
    AND (
      p_include_weekends
      OR EXTRACT(DOW FROM ws.date)::integer NOT IN (0, 6)
    )
    AND (ws.daily_streams::numeric / NULLIF(ws.avg_same_dow, 0)) >= p_spike_ratio
    AND NOT (ws.prev_cum = 0 AND ws.streams_cumulative <= p_threshold_crossing_max)
    AND (
      (
        CASE
          WHEN tr.first_seen IS NULL THEN ws.first_observed_date
          WHEN tr.first_seen::date > ws.first_observed_date THEN ws.first_observed_date
          ELSE tr.first_seen::date
        END
      ) IS NULL
      OR (
        ws.date - (
          CASE
            WHEN tr.first_seen IS NULL THEN ws.first_observed_date
            WHEN tr.first_seen::date > ws.first_observed_date THEN ws.first_observed_date
            ELSE tr.first_seen::date
          END
        )
      ) >= p_grace_days
    )
  ORDER BY spike_ratio DESC, ws.date DESC, tr.isrc;
$$;

GRANT EXECUTE ON FUNCTION public.home_artificial_stream_spikes(
  numeric, numeric, integer, bigint, boolean
) TO anon, authenticated;
