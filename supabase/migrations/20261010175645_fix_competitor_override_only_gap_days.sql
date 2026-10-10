-- Restore override-only competitor days after optimize_effective_stream_views_pushdown.sql.
-- Keep the narrow projection and UNION ALL branches so date/ISRC filters can push down.
CREATE OR REPLACE VIEW competitor.track_daily_streams_effective_public AS
SELECT t.date,t.isrc,
       COALESCE(o.streams_cumulative_override,t.streams_cumulative) AS streams_cumulative
FROM competitor.track_daily_streams t
LEFT JOIN competitor.track_daily_stream_overrides o ON o.date=t.date AND o.isrc=t.isrc
UNION ALL
SELECT o.date,o.isrc,o.streams_cumulative_override AS streams_cumulative
FROM competitor.track_daily_stream_overrides o
WHERE NOT EXISTS (
  SELECT 1 FROM competitor.track_daily_streams t WHERE t.date=o.date AND t.isrc=o.isrc
);

-- Avoid a full-history self-join of the union view. Retain exact calendar-day
-- adjacency: LAG must not turn a missing day into a single-day negative delta.
CREATE OR REPLACE FUNCTION competitor.home_negative_daily_streams(p_label_key text DEFAULT NULL)
RETURNS TABLE(isrc text,name text,artist_names text[],artist_ids text[],
 album_image_url text,date date,daily_streams_delta bigint,total_streams_cumulative bigint)
LANGUAGE sql STABLE
SET search_path TO competitor,public
SET statement_timeout TO '30s'
AS $function$
WITH daily AS (
 SELECT s.date,s.isrc,s.streams_cumulative,
        lag(s.date) OVER w AS prev_date,
        lag(s.streams_cumulative) OVER w AS prev_streams
 FROM competitor.track_daily_streams_effective_public s
 WINDOW w AS (PARTITION BY s.isrc ORDER BY s.date)
)
SELECT t.isrc,COALESCE(t.name,t.isrc)::text,t.spotify_artist_names::text[],
       t.spotify_artist_ids::text[],t.spotify_album_image_url::text,d.date,
       (d.streams_cumulative-d.prev_streams)::bigint,d.streams_cumulative::bigint
FROM daily d
JOIN competitor.tracks t ON t.isrc=d.isrc
WHERE d.prev_date=d.date-1
  AND d.streams_cumulative IS NOT NULL AND d.prev_streams IS NOT NULL
  AND d.streams_cumulative<d.prev_streams
  AND EXISTS (
    SELECT 1 FROM competitor.playlist_memberships sm
    JOIN competitor.playlists sp ON sp.playlist_key=sm.playlist_key
    WHERE sm.isrc=d.isrc AND sp.is_active
      AND (p_label_key IS NULL OR sp.label_key=p_label_key)
      AND sm.valid_from<=d.date AND (sm.valid_to IS NULL OR sm.valid_to>=d.date)
  )
ORDER BY d.date DESC,(d.streams_cumulative-d.prev_streams) ASC;
$function$;

-- CREATE OR REPLACE retains existing ownership and grants. No raw data changes.
