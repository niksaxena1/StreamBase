-- Migration: Home page track weekend dips
-- Run this in your Supabase SQL editor.
--
-- Goal:
-- - Support a Home dashboard toggle to view weekend dip % at the track level
-- - Weekend dip % is computed the same way as charts, in *data-date* space:
--   data_date = run_date - 2 days (SOT_DATA_LAG_DAYS)
--
-- Returns:
-- - isrc, name, album_image_url, artist_name
-- - weekday_avg (Mon–Fri average daily streams, requires >=3 weekdays)
-- - Sat/Sun daily streams and dip percentages, plus a combined avg dip %

CREATE OR REPLACE FUNCTION public.home_track_weekend_dips(
  p_min_weekday_avg NUMERIC DEFAULT 0,
  p_anchor_data_date DATE DEFAULT NULL
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_name TEXT,
  weekday_avg NUMERIC,
  sat_streams BIGINT,
  sun_streams BIGINT,
  sat_dip_pct NUMERIC,
  sun_dip_pct NUMERIC,
  avg_dip_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT
      INTERVAL '2 days' AS lag, -- must match app's SOT_DATA_LAG_DAYS
      COALESCE(p_anchor_data_date, '9999-12-31'::date) AS anchor_data_date
  ),
  weekend AS (
    -- Anchor on latest Sunday in DATA DATE space.
    SELECT MAX((s.date - p.lag))::date AS sun_data_date
    FROM public.track_daily_streams_effective_public s
    JOIN params p ON TRUE
    WHERE EXTRACT(DOW FROM (s.date - p.lag)) = 0
      AND ((s.date - p.lag)::date) <= p.anchor_data_date
  ),
  dates AS (
    SELECT
      w.sun_data_date,
      (w.sun_data_date - INTERVAL '1 day')::date AS sat_data_date,
      (w.sun_data_date - INTERVAL '6 days')::date AS mon_data_date,
      (w.sun_data_date - INTERVAL '5 days')::date AS tue_data_date,
      (w.sun_data_date - INTERVAL '4 days')::date AS wed_data_date,
      (w.sun_data_date - INTERVAL '3 days')::date AS thu_data_date,
      (w.sun_data_date - INTERVAL '2 days')::date AS fri_data_date,
      (w.sun_data_date - INTERVAL '7 days')::date AS prev_sun_data_date,
      -- Corresponding run dates (data date + lag)
      ((w.sun_data_date + p.lag))::date AS sun_run_date,
      ((w.sun_data_date - INTERVAL '1 day' + p.lag))::date AS sat_run_date,
      ((w.sun_data_date - INTERVAL '6 days' + p.lag))::date AS mon_run_date,
      ((w.sun_data_date - INTERVAL '5 days' + p.lag))::date AS tue_run_date,
      ((w.sun_data_date - INTERVAL '4 days' + p.lag))::date AS wed_run_date,
      ((w.sun_data_date - INTERVAL '3 days' + p.lag))::date AS thu_run_date,
      ((w.sun_data_date - INTERVAL '2 days' + p.lag))::date AS fri_run_date,
      ((w.sun_data_date - INTERVAL '7 days' + p.lag))::date AS prev_sun_run_date
    FROM weekend w
    JOIN params p ON TRUE
  ),
  base AS (
    SELECT
      s.date::date AS date,
      s.isrc::text AS isrc,
      COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM public.track_daily_streams_effective_public s
    JOIN dates d ON TRUE
    WHERE s.date >= d.prev_sun_run_date
      AND s.date <= d.sun_run_date
  ),
  daily AS (
    SELECT
      (cur.date - p.lag)::date AS date,
      cur.isrc,
      CASE
        WHEN prev.streams_cumulative IS NULL THEN NULL
        ELSE (cur.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams
    FROM base cur
    JOIN dates d ON TRUE
    JOIN params p ON TRUE
    LEFT JOIN base prev
      ON prev.isrc = cur.isrc
     AND prev.date = (cur.date - INTERVAL '1 day')::date
    WHERE cur.date >= d.mon_run_date
      AND cur.date <= d.sun_run_date
  ),
  pivot AS (
    SELECT
      dly.isrc,
      MAX(CASE WHEN dly.date = d.mon_data_date THEN dly.daily_streams END) AS mon_streams,
      MAX(CASE WHEN dly.date = d.tue_data_date THEN dly.daily_streams END) AS tue_streams,
      MAX(CASE WHEN dly.date = d.wed_data_date THEN dly.daily_streams END) AS wed_streams,
      MAX(CASE WHEN dly.date = d.thu_data_date THEN dly.daily_streams END) AS thu_streams,
      MAX(CASE WHEN dly.date = d.fri_data_date THEN dly.daily_streams END) AS fri_streams,
      MAX(CASE WHEN dly.date = d.sat_data_date THEN dly.daily_streams END) AS sat_streams,
      MAX(CASE WHEN dly.date = d.sun_data_date THEN dly.daily_streams END) AS sun_streams
    FROM daily dly
    JOIN dates d ON TRUE
    GROUP BY dly.isrc
  ),
  with_avg AS (
    SELECT
      p.*,
      (
        (CASE WHEN p.mon_streams IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN p.tue_streams IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN p.wed_streams IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN p.thu_streams IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN p.fri_streams IS NULL THEN 0 ELSE 1 END)
      ) AS valid_weekday_count,
      (
        (CASE WHEN p.mon_streams IS NULL THEN 0 ELSE p.mon_streams END) +
        (CASE WHEN p.tue_streams IS NULL THEN 0 ELSE p.tue_streams END) +
        (CASE WHEN p.wed_streams IS NULL THEN 0 ELSE p.wed_streams END) +
        (CASE WHEN p.thu_streams IS NULL THEN 0 ELSE p.thu_streams END) +
        (CASE WHEN p.fri_streams IS NULL THEN 0 ELSE p.fri_streams END)
      )::numeric
      / NULLIF(
        (
          (CASE WHEN p.mon_streams IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN p.tue_streams IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN p.wed_streams IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN p.thu_streams IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN p.fri_streams IS NULL THEN 0 ELSE 1 END)
        ),
        0
      ) AS weekday_avg
    FROM pivot p
  ),
  with_dips AS (
    SELECT
      w.isrc,
      w.weekday_avg,
      w.sat_streams,
      w.sun_streams,
      CASE
        WHEN w.weekday_avg > 0 AND w.sat_streams IS NOT NULL
        THEN ((w.sat_streams::numeric - w.weekday_avg) / w.weekday_avg) * 100
        ELSE NULL
      END AS sat_dip_pct,
      CASE
        WHEN w.weekday_avg > 0 AND w.sun_streams IS NOT NULL
        THEN ((w.sun_streams::numeric - w.weekday_avg) / w.weekday_avg) * 100
        ELSE NULL
      END AS sun_dip_pct
    FROM with_avg w
    WHERE w.valid_weekday_count >= 3
      AND w.weekday_avg >= p_min_weekday_avg
  )
  SELECT
    d.isrc,
    COALESCE(t.name, d.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    COALESCE(t.spotify_artist_names[1], NULL)::text AS artist_name,
    ROUND(d.weekday_avg)::numeric AS weekday_avg,
    d.sat_streams,
    d.sun_streams,
    ROUND(d.sat_dip_pct, 1)::numeric AS sat_dip_pct,
    ROUND(d.sun_dip_pct, 1)::numeric AS sun_dip_pct,
    ROUND(
      (COALESCE(d.sat_dip_pct, 0) + COALESCE(d.sun_dip_pct, 0))
      / NULLIF((CASE WHEN d.sat_dip_pct IS NULL THEN 0 ELSE 1 END) + (CASE WHEN d.sun_dip_pct IS NULL THEN 0 ELSE 1 END), 0),
      1
    )::numeric AS avg_dip_pct
  FROM with_dips d
  JOIN public.tracks t USING (isrc)
  ORDER BY avg_dip_pct ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.home_track_weekend_dips(NUMERIC, DATE) TO anon, authenticated;

