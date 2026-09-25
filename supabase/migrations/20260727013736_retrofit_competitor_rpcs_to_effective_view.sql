-- Migration: Retrofit competitor analytics RPCs onto the effective streams view
--
-- All competitor RPCs that previously read competitor.track_daily_streams directly now
-- read competitor.track_daily_streams_effective_public, so manual and auto-interpolated
-- overrides (see add_competitor_stream_overrides_and_interpolation.sql) flow into every
-- competitor dashboard. Definitions below are the live production definitions with only
-- the table reference swapped. ensure_track_daily_streams_partitions is intentionally
-- untouched (DDL helper on the physical table).

CREATE OR REPLACE FUNCTION competitor.catalog_artist_series(artist_id text, start_date date, end_date date)
 RETURNS TABLE(date date, streams_cumulative bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    s.date,
    COALESCE(SUM(s.streams_cumulative), 0)::bigint AS streams_cumulative
  FROM competitor.track_daily_streams_effective_public s
  JOIN competitor.tracks t USING (isrc)
  WHERE t.spotify_artist_ids @> ARRAY[$1]
    AND s.date BETWEEN $2 AND $3
  GROUP BY s.date
  ORDER BY s.date ASC;
$function$
;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_series_fast(artist_id text, start_date date, end_date date)
 RETURNS TABLE(date date, streams_cumulative bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
    FROM competitor.track_daily_streams_effective_public s
    JOIN missing_dates md ON md.date = s.date
    JOIN artist_isrcs a USING (isrc)
    GROUP BY s.date
  )
  SELECT summary_rows.date, summary_rows.streams_cumulative FROM summary_rows
  UNION ALL
  SELECT raw_rows.date, raw_rows.streams_cumulative FROM raw_rows
  ORDER BY 1 ASC;
$function$
;

CREATE OR REPLACE FUNCTION competitor.catalog_artist_top_tracks_total(artist_id text, run_date date, limit_rows integer DEFAULT 1000)
 RETURNS TABLE(isrc text, name text, album_image_url text, total bigint, daily bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    t.isrc,
    t.name,
    t.spotify_album_image_url::text AS album_image_url,
    today.streams_cumulative::bigint AS total,
    CASE
      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE today.streams_cumulative - prev.streams_cumulative
    END::bigint AS daily
  FROM competitor.tracks t
  LEFT JOIN competitor.track_daily_streams_effective_public today
    ON today.isrc = t.isrc
   AND today.date = $2
  LEFT JOIN competitor.track_daily_streams_effective_public prev
    ON prev.isrc = t.isrc
   AND prev.date = ($2 - INTERVAL '1 day')::date
  WHERE t.spotify_artist_ids @> ARRAY[$1]
  ORDER BY total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($3, 1000), 0);
$function$
;

CREATE OR REPLACE FUNCTION competitor.home_artificial_stream_spikes(p_spike_ratio numeric DEFAULT 1.25, p_min_baseline numeric DEFAULT 50, p_grace_days integer DEFAULT 14, p_threshold_crossing_max bigint DEFAULT 1500, p_include_weekends boolean DEFAULT false, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, artist_names text[], artist_ids text[], album_image_url text, date date, daily_streams bigint, avg_same_dow numeric, spike_ratio numeric, streams_cumulative bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH seq AS (
    SELECT
      tds.isrc,
      tds.date::date AS d,
      tds.streams_cumulative,
      LAG(tds.streams_cumulative) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_cum,
      LAG(tds.date) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_date
    FROM competitor.track_daily_streams_effective_public tds
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
$function$
;

CREATE OR REPLACE FUNCTION competitor.home_artist_weekend_dips(p_min_weekday_avg numeric DEFAULT 0, p_anchor_snapshot_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(artist_id text, artist_name text, image_url text, track_count bigint, weekday_avg numeric, sat_streams bigint, sun_streams bigint, sat_dip_pct numeric, sun_dip_pct numeric, avg_dip_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH params AS (
    SELECT COALESCE(p_anchor_snapshot_date, '9999-12-31'::date) AS anchor_snapshot_date
  ),
  weekend AS (
    SELECT MAX(s.date)::date AS sun_snapshot_date
    FROM competitor.track_daily_streams_effective_public s
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
    FROM competitor.track_daily_streams_effective_public s
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
$function$
;

CREATE OR REPLACE FUNCTION competitor.home_negative_daily_streams(p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, artist_names text[], artist_ids text[], album_image_url text, date date, daily_streams_delta bigint, total_streams_cumulative bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$ SELECT t.isrc, COALESCE(t.name, t.isrc)::text AS name, t.spotify_artist_names::text[] AS artist_names, t.spotify_artist_ids::text[] AS artist_ids, t.spotify_album_image_url::text AS album_image_url, today.date, (today.streams_cumulative - prev.streams_cumulative)::bigint AS daily_streams_delta, today.streams_cumulative::bigint AS total_streams_cumulative FROM competitor.track_daily_streams_effective_public today JOIN competitor.track_daily_streams_effective_public prev ON prev.isrc = today.isrc AND prev.date = (today.date - INTERVAL '1 day')::date JOIN competitor.tracks t ON t.isrc = today.isrc JOIN competitor.scoped_isrcs_for_label(p_label_key, today.date) scoped ON scoped.isrc = today.isrc WHERE today.streams_cumulative IS NOT NULL AND prev.streams_cumulative IS NOT NULL AND today.streams_cumulative < prev.streams_cumulative ORDER BY today.date DESC, daily_streams_delta ASC; $function$
;

CREATE OR REPLACE FUNCTION competitor.home_track_scatter_points_for_label(label_key text, run_date date, prev_date date)
 RETURNS TABLE(isrc text, name text, release_date date, artist_names text[], artist_ids text[], album_image_url text, spotify_track_id text, total_streams_cumulative bigint, daily_streams_delta bigint, has_prev_day boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$

  WITH scoped_playlists AS (

    SELECT playlist_key

    FROM competitor.playlists

    WHERE competitor.playlists.label_key = $1

  ),

  scoped_isrcs AS (

    SELECT DISTINCT m.isrc

    FROM competitor.playlist_memberships m

    JOIN scoped_playlists p USING (playlist_key)

    WHERE m.valid_from <= $2

      AND (m.valid_to IS NULL OR m.valid_to >= $2)

  )

  SELECT

    t.isrc,

    t.name,

    t.release_date,

    t.spotify_artist_names::text[] AS artist_names,

    t.spotify_artist_ids::text[] AS artist_ids,

    t.spotify_album_image_url::text AS album_image_url,

    t.spotify_track_id::text AS spotify_track_id,

    today.streams_cumulative::bigint AS total_streams_cumulative,

    CASE

      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL

      ELSE today.streams_cumulative - prev.streams_cumulative

    END::bigint AS daily_streams_delta,

    prev.streams_cumulative IS NOT NULL AS has_prev_day

  FROM scoped_isrcs s

  JOIN competitor.tracks t USING (isrc)

  LEFT JOIN competitor.track_daily_streams_effective_public today

    ON today.isrc = t.isrc

   AND today.date = $2

  LEFT JOIN competitor.track_daily_streams_effective_public prev

    ON prev.isrc = t.isrc

   AND prev.date = $3

  WHERE today.streams_cumulative IS NOT NULL

  ORDER BY total_streams_cumulative DESC NULLS LAST, t.name ASC;

$function$
;

CREATE OR REPLACE FUNCTION competitor.home_track_weekend_dips(p_min_weekday_avg numeric DEFAULT 0, p_anchor_snapshot_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_name text, weekday_avg numeric, sat_streams bigint, sun_streams bigint, sat_dip_pct numeric, sun_dip_pct numeric, avg_dip_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH params AS (
    SELECT COALESCE(p_anchor_snapshot_date, '9999-12-31'::date) AS anchor_snapshot_date
  ),
  weekend AS (
    SELECT MAX(s.date)::date AS sun_snapshot_date
    FROM competitor.track_daily_streams_effective_public s
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
    FROM competitor.track_daily_streams_effective_public s
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
$function$
;

CREATE OR REPLACE FUNCTION competitor.label_artists_paged(p_label_key text, p_run_date date, p_offset integer DEFAULT 0, p_limit integer DEFAULT 200)
 RETURNS TABLE(artist_id text, name text, image_url text, track_count bigint, total_streams_cumulative bigint, daily_streams_delta bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH scoped AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_label_key
      AND m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
  ),
  track_rows AS (
    SELECT
      t.isrc,
      t.spotify_artist_ids,
      t.spotify_artist_names,
      t.spotify_album_image_url,
      COALESCE(today.streams_cumulative, 0)::bigint AS total_streams_cumulative,
      CASE
        WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
        ELSE (today.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams_delta
    FROM scoped s
    JOIN competitor.tracks t USING (isrc)
    LEFT JOIN competitor.track_daily_streams_effective_public today
      ON today.isrc = s.isrc AND today.date = p_run_date
    LEFT JOIN competitor.track_daily_streams_effective_public prev
      ON prev.isrc = s.isrc AND prev.date = p_run_date - INTERVAL '1 day'
  ),
  artist_rows AS (
    SELECT
      a.artist_id,
      a.artist_name,
      MAX(tr.spotify_album_image_url)::text AS image_url,
      COUNT(DISTINCT tr.isrc)::bigint AS track_count,
      SUM(tr.total_streams_cumulative)::bigint AS total_streams_cumulative,
      SUM(COALESCE(tr.daily_streams_delta, 0))::bigint AS daily_streams_delta
    FROM track_rows tr
    CROSS JOIN LATERAL unnest(tr.spotify_artist_ids, tr.spotify_artist_names) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL AND a.artist_name IS NOT NULL
    GROUP BY a.artist_id, a.artist_name
  )
  SELECT
    artist_id,
    artist_name AS name,
    image_url,
    track_count,
    total_streams_cumulative,
    daily_streams_delta
  FROM artist_rows
  ORDER BY total_streams_cumulative DESC NULLS LAST, name ASC
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 200), 0);
$function$
;

CREATE OR REPLACE FUNCTION competitor.label_top_tracks_daily(p_run_date date, p_limit integer DEFAULT 20, p_direction text DEFAULT 'gainers'::text)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_names text[], artist_ids text[], label_keys text[], daily_delta bigint, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH today AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams_effective_public s
    WHERE s.date = p_run_date
  ),
  yday AS (
    SELECT s.isrc, s.streams_cumulative
    FROM competitor.track_daily_streams_effective_public s
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
    ranked.artist_ids,
    ranked.label_keys,
    ranked.daily_delta,
    ranked.total
  FROM (
    SELECT
      t.isrc,
      COALESCE(t.name, t.isrc)::text AS name,
      t.spotify_album_image_url::text AS album_image_url,
      t.spotify_artist_names::text[] AS artist_names,
      t.spotify_artist_ids::text[] AS artist_ids,
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
$function$
;

CREATE OR REPLACE FUNCTION competitor.label_tracks_paged(p_label_key text, p_run_date date, p_offset integer DEFAULT 0, p_limit integer DEFAULT 200)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_names text[], artist_ids text[], total_streams_cumulative bigint, daily_streams_delta bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH scoped AS (
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p USING (playlist_key)
    WHERE p.label_key = p_label_key
      AND m.valid_from <= p_run_date
      AND (m.valid_to IS NULL OR m.valid_to >= p_run_date)
  )
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    COALESCE(today.streams_cumulative, 0)::bigint AS total_streams_cumulative,
    CASE
      WHEN today.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE (today.streams_cumulative - prev.streams_cumulative)::bigint
    END AS daily_streams_delta
  FROM scoped s
  JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams_effective_public today
    ON today.isrc = s.isrc AND today.date = p_run_date
  LEFT JOIN competitor.track_daily_streams_effective_public prev
    ON prev.isrc = s.isrc AND prev.date = p_run_date - INTERVAL '1 day'
  ORDER BY COALESCE(today.streams_cumulative, 0) DESC NULLS LAST, t.name ASC
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 200), 0);
$function$
;

CREATE OR REPLACE FUNCTION competitor.network_selection_scoped_track_totals(p_artist_ids text[], p_playlist_key text DEFAULT NULL::text, p_hide_non_primary boolean DEFAULT false)
 RETURNS TABLE(track_count bigint, total_streams bigint, daily_streams bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
  WITH artists_input AS (
    SELECT DISTINCT btrim(x) AS artist_id
    FROM unnest(p_artist_ids) AS t(x)
    WHERE x IS NOT NULL AND btrim(x) <> ''
  ),
  scoped_isrcs AS (
    SELECT DISTINCT cm.isrc
    FROM (
      SELECT u.isrc, MAX(u.valid_from) AS valid_from
      FROM (
        SELECT
          m.isrc,
          m.valid_from::date AS valid_from,
          m.valid_to::date AS valid_to
        FROM competitor.playlist_memberships m
        WHERE p_playlist_key IS NOT NULL
          AND m.playlist_key = p_playlist_key
          AND m.valid_from <= CURRENT_DATE
          AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      ) u
      GROUP BY u.isrc
    ) cm
    WHERE p_playlist_key IS NOT NULL

    UNION ALL

    SELECT t.isrc
    FROM competitor.tracks t
    WHERE p_playlist_key IS NULL
  ),

  primary_rows AS (
    SELECT
      t.isrc,
      t.spotify_artist_ids[1] AS artist_id
    FROM competitor.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  artist_tracks AS (
    SELECT
      t.isrc,
      a.artist_id
    FROM competitor.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  artist_scoped_isrcs AS (
    SELECT DISTINCT pr.artist_id, pr.isrc
    FROM primary_rows pr
    INNER JOIN artists_input ai ON ai.artist_id = pr.artist_id
    WHERE p_hide_non_primary
    UNION ALL
    SELECT DISTINCT at.artist_id, at.isrc
    FROM artist_tracks at
    INNER JOIN artists_input ai ON ai.artist_id = at.artist_id
    WHERE NOT p_hide_non_primary
  ),

  selection_isrcs AS (
    SELECT DISTINCT isrc
    FROM artist_scoped_isrcs
  ),

  latest AS (
    SELECT max(date)::date AS d FROM competitor.track_daily_streams_effective_public
  ),
  previous AS (
    SELECT max(t.date)::date AS d
    FROM competitor.track_daily_streams_effective_public t
    WHERE t.date < (SELECT d FROM latest)
  ),

  stream_by_isrc AS (
    SELECT
      s.isrc,
      max(s.streams_cumulative) FILTER (WHERE s.date = (SELECT d FROM latest)) AS cum_latest,
      max(s.streams_cumulative) FILTER (WHERE s.date = (SELECT d FROM previous)) AS cum_prev
    FROM competitor.track_daily_streams_effective_public s
    INNER JOIN selection_isrcs r ON r.isrc = s.isrc
    WHERE s.date IN ((SELECT d FROM latest), (SELECT d FROM previous))
    GROUP BY s.isrc
  ),

  stream_metrics AS (
    SELECT
      s.isrc,
      coalesce(s.cum_latest, 0)::bigint AS total_streams,
      CASE
        WHEN s.cum_latest IS NOT NULL AND s.cum_prev IS NOT NULL
        THEN greatest(0, s.cum_latest - s.cum_prev)::bigint
        ELSE NULL::bigint
      END AS daily_streams
    FROM stream_by_isrc s
  ),

  aggregated AS (
    SELECT
      count(DISTINCT u.isrc)::bigint AS track_count,
      coalesce(sum(sm.total_streams), 0)::bigint AS total_streams,
      coalesce(
        sum(CASE WHEN sm.daily_streams IS NOT NULL THEN sm.daily_streams ELSE 0 END),
        0
      )::bigint AS daily_streams
    FROM selection_isrcs u
    LEFT JOIN stream_metrics sm ON sm.isrc = u.isrc
  )

  SELECT track_count, total_streams, daily_streams FROM aggregated;
$function$
;

CREATE OR REPLACE FUNCTION competitor.playlist_current_tracks(playlist_key text, run_date date)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_names text[], artist_ids text[], valid_from date, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams_effective_public s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC;
$function$
;

CREATE OR REPLACE FUNCTION competitor.playlist_top_tracks_total(playlist_key text, run_date date, limit_rows integer DEFAULT 200)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_names text[], artist_ids text[], valid_from date, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams_effective_public s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($3, 200), 0);
$function$
;

CREATE OR REPLACE FUNCTION competitor.refresh_artist_daily_stats(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  FROM competitor.track_daily_streams_effective_public s
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
$function$
;
