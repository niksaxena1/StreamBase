-- Speed up the competitor Home diagnostic functions that the per-label snapshot
-- refresh (competitor.refresh_home_diag_snapshots) calls for '__all' + each label.
--
-- Why they were slow: every function was LANGUAGE sql, so it was planned once with
-- unknown parameters and ran its label filter (EXISTS over playlist_memberships)
-- AFTER scanning/windowing every stream row (1.6M rows, ~11x per refresh), and the
-- weekend-dip / spike functions scanned all history even though they only use a
-- 7-day / 30-day window.
--
-- What changed (signatures, output rows/columns, ORDER BY, SECURITY INVOKER,
-- STABLE, search_path and ACLs are unchanged; CREATE OR REPLACE only):
--   * Each function resolves the label's ISRCs FIRST into an array
--     (any ISRC with an active-playlist membership for the label; the exact
--     per-date membership check is kept afterwards), then reads streams with
--     isrc = ANY(array) and a bounded date range. plpgsql + EXECUTE ... USING so each
--     call is planned with the real array/dates (same pattern as
--     catalog_artist_series_fast in 20261011141439).
--   * home_*_weekend_dips: only the 7-day window ending on the anchor Sunday is read.
--     The anchor Sunday itself is found by walking Sundays backwards with an
--     EXISTS probe instead of aggregating MAX(date) over every scoped stream row.
--   * home_artificial_stream_spikes: only [p_start_date, p_end_date] is read (the
--     original already filtered to that range before its window functions).
--   * home_negative_daily_streams: needs full history (the Home table lists every
--     historical occurrence), so it still windows all rows of the label, but now only
--     the label's ISRCs, via a hash FULL JOIN of base rows and overrides (same
--     result as the track_daily_streams_effective view) with a larger work_mem so the
--     sort stays in memory. The date-level label EXISTS runs on the few negative rows.
--   * home_track_scatter_points_for_label: label ISRC array first, then point
--     lookups on the effective view.
-- No new indexes. No DROP/DELETE/TRUNCATE.

-- ---------------------------------------------------------------------------
-- home_negative_daily_streams
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.home_negative_daily_streams(p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, artist_names text[], artist_ids text[], album_image_url text, date date, daily_streams_delta bigint, total_streams_cumulative bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'competitor', 'public'
 SET statement_timeout TO '60s'
 SET work_mem TO '128MB'
AS $function$
DECLARE
  v_arr text[];
BEGIN
  v_arr := ARRAY(
    SELECT DISTINCT sm.isrc
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key)
  );
  RETURN QUERY EXECUTE $q$
    WITH base AS (
      SELECT b.date, b.isrc, b.streams_cumulative
      FROM competitor.track_daily_streams b
      WHERE b.isrc = ANY ($1)
    ),
    ov AS (
      SELECT o.date, o.isrc, o.streams_cumulative_override AS v
      FROM competitor.track_daily_stream_overrides o
      WHERE o.isrc = ANY ($1)
    ),
    eff AS (
      SELECT COALESCE(o.date, b.date) AS date,
             COALESCE(o.isrc, b.isrc) AS isrc,
             CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
      FROM base b
      FULL JOIN ov o ON o.date = b.date AND o.isrc = b.isrc
    ),
    daily AS (
      SELECT e.date, e.isrc, e.streams_cumulative,
             lag(e.date) OVER w AS prev_date,
             lag(e.streams_cumulative) OVER w AS prev_streams
      FROM eff e
      WINDOW w AS (PARTITION BY e.isrc ORDER BY e.date)
    )
    SELECT t.isrc, COALESCE(t.name, t.isrc)::text, t.spotify_artist_names::text[],
           t.spotify_artist_ids::text[], t.spotify_album_image_url::text, d.date,
           (d.streams_cumulative - d.prev_streams)::bigint, d.streams_cumulative::bigint
    FROM daily d
    JOIN competitor.tracks t ON t.isrc = d.isrc
    WHERE d.prev_date = d.date - 1
      AND d.streams_cumulative IS NOT NULL AND d.prev_streams IS NOT NULL
      AND d.streams_cumulative < d.prev_streams
      AND EXISTS (
        SELECT 1 FROM competitor.playlist_memberships sm
        JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
        WHERE sm.isrc = d.isrc AND sp.is_active
          AND ($2::text IS NULL OR sp.label_key = $2::text)
          AND sm.valid_from <= d.date AND (sm.valid_to IS NULL OR sm.valid_to >= d.date)
      )
    ORDER BY d.date DESC, (d.streams_cumulative - d.prev_streams) ASC
  $q$ USING v_arr, p_label_key;
END;
$function$;

-- ---------------------------------------------------------------------------
-- home_track_weekend_dips
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.home_track_weekend_dips(p_min_weekday_avg numeric DEFAULT 0, p_anchor_snapshot_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, album_image_url text, artist_name text, weekday_avg numeric, sat_streams bigint, sun_streams bigint, sat_dip_pct numeric, sun_dip_pct numeric, avg_dip_pct numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'competitor', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_arr text[];
  v_hi date;
  v_lo date;
  v_d date;
  v_sun date;
BEGIN
  v_arr := ARRAY(
    SELECT DISTINCT sm.isrc
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key)
  );
  v_hi := GREATEST((SELECT max(b.date) FROM competitor.track_daily_streams b),
                   (SELECT max(o.date) FROM competitor.track_daily_stream_overrides o));
  v_lo := LEAST((SELECT min(b.date) FROM competitor.track_daily_streams b),
                (SELECT min(o.date) FROM competitor.track_daily_stream_overrides o));
  IF v_hi IS NULL OR v_lo IS NULL THEN RETURN; END IF;
  v_hi := LEAST(COALESCE(p_anchor_snapshot_date, '9999-12-31'::date), v_hi);

  -- Latest Sunday <= anchor with at least one label-scoped effective stream row.
  FOR v_d IN
    SELECT g::date FROM generate_series(v_hi::timestamp, v_lo::timestamp, interval '-1 day') g
    WHERE EXTRACT(DOW FROM g) = 0
  LOOP
    IF EXISTS (
         SELECT 1 FROM competitor.track_daily_streams b
         WHERE b.date = v_d AND b.isrc = ANY (v_arr)
           AND EXISTS (SELECT 1 FROM competitor.playlist_memberships sm JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key WHERE sm.isrc = b.isrc AND sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key) AND sm.valid_from <= b.date AND (sm.valid_to IS NULL OR sm.valid_to >= b.date)))
       OR EXISTS (
         SELECT 1 FROM competitor.track_daily_stream_overrides o
         WHERE o.date = v_d AND o.isrc = ANY (v_arr)
           AND EXISTS (SELECT 1 FROM competitor.playlist_memberships sm JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key WHERE sm.isrc = o.isrc AND sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key) AND sm.valid_from <= o.date AND (sm.valid_to IS NULL OR sm.valid_to >= o.date)))
    THEN
      v_sun := v_d;
      EXIT;
    END IF;
  END LOOP;
  IF v_sun IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE $q$
  WITH dates AS (
    SELECT
      w.sun_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '1 day')::date AS sat_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '6 days')::date AS mon_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '5 days')::date AS tue_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '4 days')::date AS wed_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '3 days')::date AS thu_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '2 days')::date AS fri_snapshot_date
    FROM (SELECT $3::date AS sun_snapshot_date) w
  ),
  mem AS MATERIALIZED (
    SELECT sm.isrc, sm.valid_from, sm.valid_to
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND ($5::text IS NULL OR sp.label_key = $5::text)
  ),
  eff AS (
    SELECT COALESCE(o.date, b.date) AS date,
           COALESCE(o.isrc, b.isrc) AS isrc,
           CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
    FROM (SELECT x.date, x.isrc, x.streams_cumulative FROM competitor.track_daily_streams x
          WHERE x.isrc = ANY ($1) AND x.date >= $2 AND x.date <= $3) b
    FULL JOIN (SELECT y.date, y.isrc, y.streams_cumulative_override AS v FROM competitor.track_daily_stream_overrides y
               WHERE y.isrc = ANY ($1) AND y.date >= $2 AND y.date <= $3) o
      ON o.date = b.date AND o.isrc = b.isrc
  ),
  base AS (
    SELECT
      s.date::date AS date,
      s.isrc::text AS isrc,
      COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM eff s
    WHERE EXISTS (SELECT 1 FROM mem m WHERE m.isrc = s.isrc AND m.valid_from <= s.date AND (m.valid_to IS NULL OR m.valid_to >= s.date))
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
      AND w.weekday_avg >= $4
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
  ORDER BY avg_dip_pct ASC NULLS LAST
  $q$ USING v_arr, v_sun - 6, v_sun, p_min_weekday_avg, p_label_key;
END;
$function$;

-- ---------------------------------------------------------------------------
-- home_artist_weekend_dips
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.home_artist_weekend_dips(p_min_weekday_avg numeric DEFAULT 0, p_anchor_snapshot_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(artist_id text, artist_name text, image_url text, track_count bigint, weekday_avg numeric, sat_streams bigint, sun_streams bigint, sat_dip_pct numeric, sun_dip_pct numeric, avg_dip_pct numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'competitor', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_arr text[];
  v_hi date;
  v_lo date;
  v_d date;
  v_sun date;
BEGIN
  v_arr := ARRAY(
    SELECT DISTINCT sm.isrc
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key)
  );
  v_hi := GREATEST((SELECT max(b.date) FROM competitor.track_daily_streams b),
                   (SELECT max(o.date) FROM competitor.track_daily_stream_overrides o));
  v_lo := LEAST((SELECT min(b.date) FROM competitor.track_daily_streams b),
                (SELECT min(o.date) FROM competitor.track_daily_stream_overrides o));
  IF v_hi IS NULL OR v_lo IS NULL THEN RETURN; END IF;
  v_hi := LEAST(COALESCE(p_anchor_snapshot_date, '9999-12-31'::date), v_hi);

  -- Latest Sunday <= anchor with at least one label-scoped effective stream row.
  FOR v_d IN
    SELECT g::date FROM generate_series(v_hi::timestamp, v_lo::timestamp, interval '-1 day') g
    WHERE EXTRACT(DOW FROM g) = 0
  LOOP
    IF EXISTS (
         SELECT 1 FROM competitor.track_daily_streams b
         WHERE b.date = v_d AND b.isrc = ANY (v_arr)
           AND EXISTS (SELECT 1 FROM competitor.playlist_memberships sm JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key WHERE sm.isrc = b.isrc AND sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key) AND sm.valid_from <= b.date AND (sm.valid_to IS NULL OR sm.valid_to >= b.date)))
       OR EXISTS (
         SELECT 1 FROM competitor.track_daily_stream_overrides o
         WHERE o.date = v_d AND o.isrc = ANY (v_arr)
           AND EXISTS (SELECT 1 FROM competitor.playlist_memberships sm JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key WHERE sm.isrc = o.isrc AND sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key) AND sm.valid_from <= o.date AND (sm.valid_to IS NULL OR sm.valid_to >= o.date)))
    THEN
      v_sun := v_d;
      EXIT;
    END IF;
  END LOOP;
  IF v_sun IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE $q$
  WITH dates AS (
    SELECT
      w.sun_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '1 day')::date AS sat_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '6 days')::date AS mon_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '5 days')::date AS tue_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '4 days')::date AS wed_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '3 days')::date AS thu_snapshot_date,
      (w.sun_snapshot_date - INTERVAL '2 days')::date AS fri_snapshot_date
    FROM (SELECT $3::date AS sun_snapshot_date) w
  ),
  mem AS MATERIALIZED (
    SELECT sm.isrc, sm.valid_from, sm.valid_to
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND ($5::text IS NULL OR sp.label_key = $5::text)
  ),
  eff AS (
    SELECT COALESCE(o.date, b.date) AS date,
           COALESCE(o.isrc, b.isrc) AS isrc,
           CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
    FROM (SELECT x.date, x.isrc, x.streams_cumulative FROM competitor.track_daily_streams x
          WHERE x.isrc = ANY ($1) AND x.date >= $2 AND x.date <= $3) b
    FULL JOIN (SELECT y.date, y.isrc, y.streams_cumulative_override AS v FROM competitor.track_daily_stream_overrides y
               WHERE y.isrc = ANY ($1) AND y.date >= $2 AND y.date <= $3) o
      ON o.date = b.date AND o.isrc = b.isrc
  ),
  base AS (
    SELECT
      s.date::date AS date,
      s.isrc::text AS isrc,
      COALESCE(s.streams_cumulative, 0)::bigint AS streams_cumulative
    FROM eff s
    WHERE EXISTS (SELECT 1 FROM mem m WHERE m.isrc = s.isrc AND m.valid_from <= s.date AND (m.valid_to IS NULL OR m.valid_to >= s.date))
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
      AND w.weekday_avg >= $4
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
  ORDER BY avg_dip_pct ASC NULLS LAST
  $q$ USING v_arr, v_sun - 6, v_sun, p_min_weekday_avg, p_label_key;
END;
$function$;

-- ---------------------------------------------------------------------------
-- home_artificial_stream_spikes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.home_artificial_stream_spikes(p_spike_ratio numeric DEFAULT 1.25, p_min_baseline numeric DEFAULT 50, p_grace_days integer DEFAULT 14, p_threshold_crossing_max bigint DEFAULT 1500, p_include_weekends boolean DEFAULT false, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_label_key text DEFAULT NULL::text)
 RETURNS TABLE(isrc text, name text, artist_names text[], artist_ids text[], album_image_url text, date date, daily_streams bigint, avg_same_dow numeric, spike_ratio numeric, streams_cumulative bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'competitor', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_arr text[];
BEGIN
  v_arr := ARRAY(
    SELECT DISTINCT sm.isrc
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND (p_label_key IS NULL OR sp.label_key = p_label_key)
  );
  RETURN QUERY EXECUTE $q$
  WITH mem AS MATERIALIZED (
    SELECT sm.isrc, sm.valid_from, sm.valid_to
    FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key = sm.playlist_key
    WHERE sp.is_active AND ($9::text IS NULL OR sp.label_key = $9::text)
  ),
  eff AS (
    SELECT COALESCE(o.date, b.date) AS date,
           COALESCE(o.isrc, b.isrc) AS isrc,
           CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
    FROM (SELECT x.date, x.isrc, x.streams_cumulative FROM competitor.track_daily_streams x
          WHERE x.isrc = ANY ($1) AND x.date >= COALESCE($7::date, '-infinity'::date) AND x.date <= COALESCE($8::date, 'infinity'::date)) b
    FULL JOIN (SELECT y.date, y.isrc, y.streams_cumulative_override AS v FROM competitor.track_daily_stream_overrides y
               WHERE y.isrc = ANY ($1) AND y.date >= COALESCE($7::date, '-infinity'::date) AND y.date <= COALESCE($8::date, 'infinity'::date)) o
      ON o.date = b.date AND o.isrc = b.isrc
  ),
  seq AS (
    SELECT
      tds.isrc,
      tds.date::date AS d,
      tds.streams_cumulative,
      LAG(tds.streams_cumulative) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_cum,
      LAG(tds.date) OVER (PARTITION BY tds.isrc ORDER BY tds.date) AS prev_date
    FROM eff tds
    WHERE EXISTS (SELECT 1 FROM mem m WHERE m.isrc = tds.isrc AND m.valid_from <= tds.date AND (m.valid_to IS NULL OR m.valid_to >= tds.date))
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
    AND ws.avg_same_dow >= $3
    AND ws.prior_sample_count >= 2
    AND (
      $6
      OR EXTRACT(DOW FROM ws.date)::integer NOT IN (0, 6)
    )
    AND (ws.daily_streams::numeric / NULLIF(ws.avg_same_dow, 0)) >= $2
    AND NOT (ws.prev_cum = 0 AND ws.streams_cumulative <= $5)
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
      ) >= $4
    )
  ORDER BY spike_ratio DESC, ws.date DESC, tr.isrc
  $q$ USING v_arr, p_spike_ratio, p_min_baseline, p_grace_days, p_threshold_crossing_max,
            p_include_weekends, p_start_date, p_end_date, p_label_key;
END;
$function$;

-- ---------------------------------------------------------------------------
-- home_track_scatter_points_for_label
-- (like the original: no is_active filter; label required)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.home_track_scatter_points_for_label(label_key text, run_date date, prev_date date)
 RETURNS TABLE(isrc text, name text, release_date date, artist_names text[], artist_ids text[], album_image_url text, spotify_track_id text, total_streams_cumulative bigint, daily_streams_delta bigint, has_prev_day boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'competitor', 'public'
AS $function$
DECLARE
  v_arr text[];
BEGIN
  v_arr := ARRAY(
    SELECT DISTINCT m.isrc
    FROM competitor.playlist_memberships m
    JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
    WHERE p.label_key = $1
      AND m.valid_from <= $2
      AND (m.valid_to IS NULL OR m.valid_to >= $2)
  );
  RETURN QUERY EXECUTE $q$
  WITH eff_today AS (
    SELECT COALESCE(o.isrc, b.isrc) AS isrc,
           CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
    FROM (SELECT x.isrc, x.streams_cumulative FROM competitor.track_daily_streams x
          WHERE x.date = $2 AND x.isrc = ANY ($1)) b
    FULL JOIN (SELECT y.isrc, y.streams_cumulative_override AS v FROM competitor.track_daily_stream_overrides y
               WHERE y.date = $2 AND y.isrc = ANY ($1)) o
      ON o.isrc = b.isrc
  ),
  eff_prev AS (
    SELECT COALESCE(o.isrc, b.isrc) AS isrc,
           CASE WHEN o.isrc IS NOT NULL THEN o.v ELSE b.streams_cumulative END AS streams_cumulative
    FROM (SELECT x.isrc, x.streams_cumulative FROM competitor.track_daily_streams x
          WHERE x.date = $3 AND x.isrc = ANY ($1)) b
    FULL JOIN (SELECT y.isrc, y.streams_cumulative_override AS v FROM competitor.track_daily_stream_overrides y
               WHERE y.date = $3 AND y.isrc = ANY ($1)) o
      ON o.isrc = b.isrc
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
  FROM competitor.tracks t
  LEFT JOIN eff_today today ON today.isrc = t.isrc
  LEFT JOIN eff_prev prev ON prev.isrc = t.isrc
  WHERE t.isrc = ANY ($1)
    AND today.streams_cumulative IS NOT NULL
  ORDER BY total_streams_cumulative DESC NULLS LAST, t.name ASC
  $q$ USING v_arr, run_date, prev_date;
END;
$function$;
