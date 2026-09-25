-- Migration: Expand Ledgenta integration public views (SpotiBase Expansion Rollout)
--
-- Adds column-safe / RLS-friendly surfaces for playlist stats, track metadata,
-- playlist+latest-stats join, and collector aggregates.
-- Run after add_public_views_for_ledgenta_playlist_integration.sql and
-- grant_anon_read_playlist_daily_stats.sql (playlist_daily_stats anon policy).

-- 1) Expand playlists_public (collector + display_order for Ledgenta sorting/grouping)
-- Keep the existing column order for CREATE OR REPLACE VIEW compatibility,
-- then append new columns at the end.
CREATE OR REPLACE VIEW public.playlists_public AS
SELECT playlist_key, display_name, is_catalog, playlist_type,
       spotify_playlist_id, spotify_playlist_image_url,
       collector, display_order
FROM public.playlists;

GRANT SELECT ON public.playlists_public TO anon, authenticated;

-- 2) Track metadata (prefer over direct `tracks` when RLS blocks anon)
CREATE OR REPLACE VIEW public.tracks_public AS
SELECT isrc, name, spotify_track_id,
       spotify_album_image_url,
       spotify_artist_ids, spotify_artist_names,
       release_date, last_seen
FROM public.tracks;

GRANT SELECT ON public.tracks_public TO anon, authenticated;

-- 3) Playlist daily stats (wrapper; anon RLS on base table still applies under invoker)
CREATE OR REPLACE VIEW public.playlist_daily_stats_public AS
SELECT date, playlist_key, track_count,
       total_streams_cumulative, daily_streams_net,
       est_revenue_daily_net, missing_streams_track_count
FROM public.playlist_daily_stats;

GRANT SELECT ON public.playlist_daily_stats_public TO anon, authenticated;

-- 4) One row per playlist joined to latest stats snapshot
CREATE OR REPLACE VIEW public.playlists_with_latest_stats_public AS
WITH latest_date AS (
  SELECT MAX(date) AS date FROM public.playlist_daily_stats
)
SELECT p.playlist_key, p.display_name, p.is_catalog, p.playlist_type,
       p.collector, p.display_order,
       p.spotify_playlist_id, p.spotify_playlist_image_url,
       s.date AS stats_date,
       s.track_count,
       s.total_streams_cumulative,
       s.daily_streams_net,
       s.est_revenue_daily_net,
       s.missing_streams_track_count
FROM public.playlists p
LEFT JOIN latest_date d ON true
LEFT JOIN public.playlist_daily_stats s
  ON s.playlist_key = p.playlist_key
 AND s.date = d.date;

GRANT SELECT ON public.playlists_with_latest_stats_public TO anon, authenticated;

-- 5) Collector aggregates (requires collector_daily_agg view from add_collectors_aggregate_views.sql)
CREATE OR REPLACE VIEW public.collector_daily_agg_public AS
SELECT collector, date, track_count,
       total_streams_cumulative, daily_streams_net,
       est_revenue_total, est_revenue_daily_net,
       missing_streams_track_count
FROM public.collector_daily_agg;

GRANT SELECT ON public.collector_daily_agg_public TO anon, authenticated;

-- 6) Low-sensitivity bridge so Ledgenta can mirror the user's SpotiBase weekday highlight choice.
CREATE OR REPLACE FUNCTION public.get_chart_week_highlight_day_for_email(email_input text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT COALESCE(s.chart_week_highlight_day, 0)
  FROM auth.users u
  LEFT JOIN public.user_settings s ON s.user_id = u.id
  WHERE lower(trim(u.email)) = lower(trim(email_input))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_chart_week_highlight_day_for_email(text) TO anon, authenticated;
