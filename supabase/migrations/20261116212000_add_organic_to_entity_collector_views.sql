-- Append organic daily streams to the entity-playlist collector views (used when
-- user_settings.collector_entity_playlist_stats_enabled), matching collector_daily_agg/compare.
CREATE OR REPLACE VIEW public.collector_daily_agg_entity_playlists AS
 WITH collector_scope AS (
         SELECT 'TG'::text AS collector, 'tg_total'::text AS playlist_key
        UNION ALL
         SELECT 'PL'::text AS collector, 'p_total'::text AS playlist_key
        UNION ALL
         SELECT upper(TRIM(BOTH FROM p.collector)) AS collector, p.playlist_key
           FROM playlists p
          WHERE ((p.collector IS NOT NULL) AND (length(TRIM(BOTH FROM p.collector)) > 0) AND (upper(TRIM(BOTH FROM p.collector)) <> ALL (ARRAY['TG'::text, 'PL'::text])))
        )
 SELECT cs.collector,
    s.date,
    sum(COALESCE(s.track_count, 0)) AS track_count,
    (sum(COALESCE(s.total_streams_cumulative, (0)::bigint)))::bigint AS total_streams_cumulative,
    (sum(COALESCE(s.daily_streams_net, (0)::bigint)))::bigint AS daily_streams_net,
    sum(COALESCE(s.est_revenue_total, (0)::numeric)) AS est_revenue_total,
    sum(COALESCE(s.est_revenue_daily_net, (0)::numeric)) AS est_revenue_daily_net,
    sum(COALESCE(s.missing_streams_track_count, 0)) AS missing_streams_track_count,
    (sum(COALESCE(s.daily_streams_organic, (0)::bigint)))::bigint AS daily_streams_organic,
    sum(COALESCE(s.est_revenue_daily_organic, (0)::numeric)) AS est_revenue_daily_organic
   FROM (collector_scope cs
     JOIN playlist_daily_stats s ON ((s.playlist_key = cs.playlist_key)))
  GROUP BY cs.collector, s.date;

CREATE OR REPLACE VIEW public.collector_daily_compare_entity_playlists AS
 SELECT collector,
    date,
    track_count,
    total_streams_cumulative,
    daily_streams_net,
    est_revenue_total,
    est_revenue_daily_net,
    missing_streams_track_count,
    (daily_streams_net - lag(daily_streams_net) OVER (PARTITION BY collector ORDER BY date)) AS daily_streams_delta_yday,
    (est_revenue_daily_net - lag(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date)) AS est_revenue_daily_delta_yday,
    (track_count - lag(track_count) OVER (PARTITION BY collector ORDER BY date)) AS track_count_delta_yday,
    avg(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS daily_streams_ma7_prev,
    avg(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS est_revenue_daily_ma7_prev,
    avg(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS track_count_ma7_prev,
    (((daily_streams_net)::numeric - avg(daily_streams_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)))::bigint AS daily_streams_delta_ma7,
    (est_revenue_daily_net - avg(est_revenue_daily_net) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)) AS est_revenue_daily_delta_ma7,
    ((track_count)::numeric - avg(track_count) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)) AS track_count_delta_ma7,
    daily_streams_organic,
    est_revenue_daily_organic,
    (daily_streams_organic - lag(daily_streams_organic) OVER (PARTITION BY collector ORDER BY date)) AS daily_streams_organic_delta_yday,
    (est_revenue_daily_organic - lag(est_revenue_daily_organic) OVER (PARTITION BY collector ORDER BY date)) AS est_revenue_daily_organic_delta_yday,
    avg(daily_streams_organic) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS daily_streams_organic_ma7_prev,
    avg(est_revenue_daily_organic) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS est_revenue_daily_organic_ma7_prev,
    (((daily_streams_organic)::numeric - avg(daily_streams_organic) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)))::bigint AS daily_streams_organic_delta_ma7,
    (est_revenue_daily_organic - avg(est_revenue_daily_organic) OVER (PARTITION BY collector ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)) AS est_revenue_daily_organic_delta_ma7
   FROM collector_daily_agg_entity_playlists;
