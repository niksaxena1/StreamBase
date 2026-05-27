-- Home dashboard diagnostics for Competitor Mode (negative streams, weekend dips, artificial spikes).
-- Scoped by label_key; NULL label_key = all active competitor labels.

CREATE OR REPLACE FUNCTION competitor.scoped_isrcs_for_label(
  p_label_key TEXT,
  p_as_of DATE
)
RETURNS TABLE (isrc TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT m.isrc
  FROM competitor.playlist_memberships m
  JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
  WHERE p.is_active = TRUE
    AND (p_label_key IS NULL OR p.label_key = p_label_key)
    AND m.valid_from <= p_as_of
    AND (m.valid_to IS NULL OR m.valid_to >= p_as_of);
$$;

CREATE OR REPLACE FUNCTION competitor.home_negative_daily_streams(
  p_label_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT,
  date DATE,
  daily_streams_delta BIGINT,
  total_streams_cumulative BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url,
    today.date,
    (today.streams_cumulative - prev.streams_cumulative)::bigint AS daily_streams_delta,
    today.streams_cumulative::bigint AS total_streams_cumulative
  FROM competitor.track_daily_streams today
  JOIN competitor.track_daily_streams prev
    ON prev.isrc = today.isrc
   AND prev.date = (today.date - INTERVAL '1 day')::date
  JOIN competitor.tracks t ON t.isrc = today.isrc
  JOIN competitor.scoped_isrcs_for_label(p_label_key, today.date) scoped ON scoped.isrc = today.isrc
  WHERE today.streams_cumulative IS NOT NULL
    AND prev.streams_cumulative IS NOT NULL
    AND today.streams_cumulative < prev.streams_cumulative
  ORDER BY today.date DESC, daily_streams_delta ASC;
$$;

CREATE OR REPLACE FUNCTION competitor.home_track_weekend_dips(
  p_min_weekday_avg NUMERIC DEFAULT 0,
  p_anchor_snapshot_date DATE DEFAULT NULL,
  p_label_key TEXT DEFAULT NULL
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
    SELECT COALESCE(p_anchor_snapshot_date, '9999-12-31'::date) AS anchor_snapshot_date
  ),
  weekend AS (
    SELECT MAX(s.date)::date AS sun_snapshot_date
    FROM competitor.track_daily_streams s
    JOIN competitor.scoped_isrcs_for_label(p_label_key, s.date) scoped ON scoped.isrc = s.isrc
    JOIN params p ON TRUE
    WHERE EXTRACT(DOW FROM s.date) = 0
      AND s.date <= p.anchor_snapshot_date
  ),
  dates AS (
    SELECT
      w.sun_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '1 day')::date AS sat_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '6 days')::date AS mon_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '5 days')::date AS tue_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '4 days')::date AS wed_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '3 days')::date AS thu_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '2 days')::date AS fri_snapshot_date
    FROM weekend w
  ),
  base AS (
    SELECT
      s.date::date AS date,
      s.isrc::text AS isrc,
      COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM competitor.track_daily_streams s
    JOIN dates d ON TRUE
    JOIN competitor.scoped_isrcs_for_label(p_label_key, s.date) scoped ON scoped.isrc = s.isrc
    WHERE s.date >= d.mon_snapshot_date
      AND s.date <= d.sun_snapshot_date
  ),
  daily AS (
    SELECT
      cur.date,
      cur.isrc,
      CASE
        WHEN prev.streams_cumulative IS NULL THEN NULL
        ELSE (cur.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams
    FROM base cur
    LEFT JOIN base prev
      ON prev.isrc = cur.isrc
     AND prev.date = (cur.date - INTERVAL '1 day')::date
  ),
  pivot AS (
    SELECT
      dly.isrc,
      MAX(CASE WHEN dly.date = d.mon_snapshot_date THEN dly.daily_streams END) AS mon_streams,
      MAX(CASE WHEN dly.date = d.tue_snapshot_date THEN dly.daily_streams END) AS tue_streams,
      MAX(CASE WHEN dly.date = d.wed_snapshot_date THEN dly.daily_streams END) AS wed_streams,
      MAX(CASE WHEN dly.date = d.thu_snapshot_date THEN dly.daily_streams END) AS thu_streams,
      MAX(CASE WHEN dly.date = d.fri_snapshot_date THEN dly.daily_streams END) AS fri_streams,
      MAX(CASE WHEN dly.date = d.sat_snapshot_date THEN dly.daily_streams END) AS sat_streams,
      MAX(CASE WHEN dly.date = d.sun_snapshot_date THEN dly.daily_streams END) AS sun_streams
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
  JOIN competitor.tracks t ON t.isrc = d.isrc
  ORDER BY avg_dip_pct ASC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION competitor.home_artist_weekend_dips(
  p_min_weekday_avg NUMERIC DEFAULT 0,
  p_anchor_snapshot_date DATE DEFAULT NULL,
  p_label_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  artist_id TEXT,
  artist_name TEXT,
  image_url TEXT,
  track_count BIGINT,
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
    SELECT COALESCE(p_anchor_snapshot_date, '9999-12-31'::date) AS anchor_snapshot_date
  ),
  weekend AS (
    SELECT MAX(s.date)::date AS sun_snapshot_date
    FROM competitor.track_daily_streams s
    JOIN competitor.scoped_isrcs_for_label(p_label_key, s.date) scoped ON scoped.isrc = s.isrc
    JOIN params p ON TRUE
    WHERE EXTRACT(DOW FROM s.date) = 0
      AND s.date <= p.anchor_snapshot_date
  ),
  dates AS (
    SELECT
      w.sun_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '1 day')::date AS sat_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '6 days')::date AS mon_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '5 days')::date AS tue_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '4 days')::date AS wed_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '3 days')::date AS thu_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '2 days')::date AS fri_snapshot_date
    FROM weekend w
  ),
  base AS (
    SELECT
      s.date::date AS date,
      s.isrc::text AS isrc,
      COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM competitor.track_daily_streams s
    JOIN dates d ON TRUE
    JOIN competitor.scoped_isrcs_for_label(p_label_key, s.date) scoped ON scoped.isrc = s.isrc
    WHERE s.date >= d.mon_snapshot_date
      AND s.date <= d.sun_snapshot_date
  ),
  daily AS (
    SELECT
      cur.date,
      cur.isrc,
      CASE
        WHEN prev.streams_cumulative IS NULL THEN NULL
        ELSE (cur.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams
    FROM base cur
    LEFT JOIN base prev
      ON prev.isrc = cur.isrc
     AND prev.date = (cur.date - INTERVAL '1 day')::date
  ),
  artist_day AS (
    SELECT
      au.artist_id::text AS artist_id,
      au.artist_name::text AS artist_name,
      dly.date,
      SUM(COALESCE(dly.daily_streams, 0))::bigint AS day_streams
    FROM daily dly
    JOIN competitor.tracks t ON t.isrc = dly.isrc
    JOIN LATERAL UNNEST(t.spotify_artist_ids, t.spotify_artist_names) AS au(artist_id, artist_name) ON TRUE
    WHERE dly.daily_streams IS NOT NULL
    GROUP BY au.artist_id, au.artist_name, dly.date
  ),
  artist_tracks AS (
    SELECT
      au.artist_id::text AS artist_id,
      COUNT(DISTINCT dly.isrc)::bigint AS track_count
    FROM daily dly
    JOIN competitor.tracks t ON t.isrc = dly.isrc
    JOIN LATERAL UNNEST(t.spotify_artist_ids) AS au(artist_id) ON TRUE
    WHERE dly.daily_streams IS NOT NULL
    GROUP BY au.artist_id
  ),
  pivot AS (
    SELECT
      ad.artist_id,
      MAX(ad.artist_name) AS artist_name,
      COALESCE(at.track_count, 0) AS track_count,
      MAX(CASE WHEN ad.date = d.mon_snapshot_date THEN ad.day_streams END) AS mon_streams,
      MAX(CASE WHEN ad.date = d.tue_snapshot_date THEN ad.day_streams END) AS tue_streams,
      MAX(CASE WHEN ad.date = d.wed_snapshot_date THEN ad.day_streams END) AS wed_streams,
      MAX(CASE WHEN ad.date = d.thu_snapshot_date THEN ad.day_streams END) AS thu_streams,
      MAX(CASE WHEN ad.date = d.fri_snapshot_date THEN ad.day_streams END) AS fri_streams,
      MAX(CASE WHEN ad.date = d.sat_snapshot_date THEN ad.day_streams END) AS sat_streams,
      MAX(CASE WHEN ad.date = d.sun_snapshot_date THEN ad.day_streams END) AS sun_streams
    FROM artist_day ad
    JOIN dates d ON TRUE
    LEFT JOIN artist_tracks at ON at.artist_id = ad.artist_id
    GROUP BY ad.artist_id, at.track_count
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
      w.artist_id,
      w.artist_name,
      w.track_count,
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
    d.artist_id,
    d.artist_name,
    NULL::text AS image_url,
    d.track_count,
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
  ORDER BY avg_dip_pct ASC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION competitor.home_artificial_stream_spikes(
  p_spike_ratio NUMERIC DEFAULT 1.25,
  p_min_baseline NUMERIC DEFAULT 50,
  p_grace_days INTEGER DEFAULT 14,
  p_threshold_crossing_max BIGINT DEFAULT 1500,
  p_include_weekends BOOLEAN DEFAULT FALSE,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_label_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  album_image_url TEXT,
  date DATE,
  daily_streams BIGINT,
  avg_same_dow NUMERIC,
  spike_ratio NUMERIC,
  streams_cumulative BIGINT
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
    FROM competitor.track_daily_streams tds
    JOIN competitor.scoped_isrcs_for_label(p_label_key, tds.date) scoped ON scoped.isrc = tds.isrc
    WHERE (p_start_date IS NULL OR tds.date::date >= p_start_date)
      AND (p_end_date IS NULL OR tds.date::date <= p_end_date)
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
      MIN(d.date) OVER (PARTITION BY d.isrc) AS first_observed_date,
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
  JOIN competitor.tracks tr ON tr.isrc = ws.isrc
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

ALTER FUNCTION competitor.scoped_isrcs_for_label(TEXT, DATE) SET search_path = competitor, public;
ALTER FUNCTION competitor.home_negative_daily_streams(TEXT) SET search_path = competitor, public;
ALTER FUNCTION competitor.home_track_weekend_dips(NUMERIC, DATE, TEXT) SET search_path = competitor, public;
ALTER FUNCTION competitor.home_artist_weekend_dips(NUMERIC, DATE, TEXT) SET search_path = competitor, public;
ALTER FUNCTION competitor.home_artificial_stream_spikes(NUMERIC, NUMERIC, INTEGER, BIGINT, BOOLEAN, DATE, DATE, TEXT) SET search_path = competitor, public;

GRANT EXECUTE ON FUNCTION competitor.scoped_isrcs_for_label(TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION competitor.home_negative_daily_streams(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION competitor.home_track_weekend_dips(NUMERIC, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION competitor.home_artist_weekend_dips(NUMERIC, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION competitor.home_artificial_stream_spikes(NUMERIC, NUMERIC, INTEGER, BIGINT, BOOLEAN, DATE, DATE, TEXT) TO authenticated, service_role;
