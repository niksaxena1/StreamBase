-- Read-only Health Events totals. Prerequisites: both schemas' stream/override
-- tables and competitor labels, playlists and memberships (foundation + overrides).
-- Resolve the cohort first, then plan the bounded joins with real parameters.
CREATE OR REPLACE FUNCTION public.health_daily_stream_totals(p_start date, p_end date)
RETURNS TABLE(date date, daily_streams bigint, tracks_counted integer, tracks_expected integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  isrcs text[];
BEGIN
  SELECT COALESCE(array_agg(t.isrc), ARRAY[]::text[]) INTO isrcs
  FROM public.tracks t;

  RETURN QUERY EXECUTE $q$
    WITH base AS (
      SELECT b.date, b.isrc, b.streams_cumulative AS v
      FROM public.track_daily_streams b
      WHERE b.isrc = ANY($1) AND b.date BETWEEN $2 - 1 AND $3
    ), ov AS (
      SELECT o.date, o.isrc, o.streams_cumulative_override AS v
      FROM public.track_daily_stream_overrides o
      WHERE o.isrc = ANY($1) AND o.date BETWEEN $2 - 1 AND $3
    ), effective AS MATERIALIZED (
      SELECT COALESCE(b.date, o.date) AS date, COALESCE(b.isrc, o.isrc) AS isrc,
             COALESCE(o.v, b.v) AS v
      FROM base b FULL JOIN ov o ON o.date = b.date AND o.isrc = b.isrc
      WHERE COALESCE(o.v, b.v) IS NOT NULL
    ), totals AS (
      SELECT prev.date + 1 AS date,
             COALESCE(SUM(GREATEST(0::bigint, today.v - prev.v))
               FILTER (WHERE today.isrc IS NOT NULL), 0)::bigint AS daily_streams,
             COUNT(DISTINCT today.isrc)::integer AS tracks_counted,
             COUNT(DISTINCT prev.isrc)::integer AS tracks_expected
      FROM effective prev
      LEFT JOIN effective today ON today.isrc = prev.isrc AND today.date = prev.date + 1
      WHERE prev.date BETWEEN $2 - 1 AND $3 - 1
      GROUP BY prev.date
    ), days AS (
      SELECT generate_series($2::timestamp, $3::timestamp, interval '1 day')::date AS date
    )
    SELECT d.date, COALESCE(t.daily_streams, 0)::bigint,
           COALESCE(t.tracks_counted, 0)::integer, COALESCE(t.tracks_expected, 0)::integer
    FROM days d LEFT JOIN totals t USING (date)
    ORDER BY d.date
  $q$ USING isrcs, p_start, p_end;
END;
$function$;

CREATE OR REPLACE FUNCTION competitor.health_daily_stream_totals(
  p_start date, p_end date, p_label_key text DEFAULT NULL
)
RETURNS TABLE(date date, daily_streams bigint, tracks_counted integer, tracks_expected integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  isrcs text[];
BEGIN
  -- One fixed, deduplicated label cohort across this bounded interval. Sharing
  -- several playlists never multiplies an ISRC's daily streams or coverage.
  SELECT COALESCE(array_agg(DISTINCT m.isrc), ARRAY[]::text[]) INTO isrcs
  FROM competitor.playlist_memberships m
  JOIN competitor.playlists p ON p.playlist_key = m.playlist_key
  JOIN competitor.labels l ON l.label_key = p.label_key
  WHERE p.is_active AND l.is_active
    AND (p_label_key IS NULL OR p.label_key = p_label_key)
    AND m.valid_from <= p_end AND (m.valid_to IS NULL OR m.valid_to >= p_start - 1);

  RETURN QUERY EXECUTE $q$
    WITH base AS (
      SELECT b.date, b.isrc, b.streams_cumulative AS v
      FROM competitor.track_daily_streams b
      WHERE b.isrc = ANY($1) AND b.date BETWEEN $2 - 1 AND $3
    ), ov AS (
      SELECT o.date, o.isrc, o.streams_cumulative_override AS v
      FROM competitor.track_daily_stream_overrides o
      WHERE o.isrc = ANY($1) AND o.date BETWEEN $2 - 1 AND $3
    ), effective AS MATERIALIZED (
      SELECT COALESCE(b.date, o.date) AS date, COALESCE(b.isrc, o.isrc) AS isrc,
             COALESCE(o.v, b.v) AS v
      FROM base b FULL JOIN ov o ON o.date = b.date AND o.isrc = b.isrc
      WHERE COALESCE(o.v, b.v) IS NOT NULL
    ), totals AS (
      SELECT prev.date + 1 AS date,
             COALESCE(SUM(GREATEST(0::bigint, today.v - prev.v))
               FILTER (WHERE today.isrc IS NOT NULL), 0)::bigint AS daily_streams,
             COUNT(DISTINCT today.isrc)::integer AS tracks_counted,
             COUNT(DISTINCT prev.isrc)::integer AS tracks_expected
      FROM effective prev
      LEFT JOIN effective today ON today.isrc = prev.isrc AND today.date = prev.date + 1
      WHERE prev.date BETWEEN $2 - 1 AND $3 - 1
      GROUP BY prev.date
    ), days AS (
      SELECT generate_series($2::timestamp, $3::timestamp, interval '1 day')::date AS date
    )
    SELECT d.date, COALESCE(t.daily_streams, 0)::bigint,
           COALESCE(t.tracks_counted, 0)::integer, COALESCE(t.tracks_expected, 0)::integer
    FROM days d LEFT JOIN totals t USING (date)
    ORDER BY d.date
  $q$ USING isrcs, p_start, p_end;
END;
$function$;

REVOKE ALL ON FUNCTION public.health_daily_stream_totals(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION competitor.health_daily_stream_totals(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_daily_stream_totals(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION competitor.health_daily_stream_totals(date, date, text) TO service_role;

COMMENT ON FUNCTION public.health_daily_stream_totals(date, date)
IS 'Health Events: like-for-like effective daily deltas clamped at zero, with prior-day coverage counts. Read-only and service-role-only.';
COMMENT ON FUNCTION competitor.health_daily_stream_totals(date, date, text)
IS 'Health Events: deduplicated active-label cohort totals and prior-day coverage. NULL label includes all active labels; read-only and service-role-only.';
