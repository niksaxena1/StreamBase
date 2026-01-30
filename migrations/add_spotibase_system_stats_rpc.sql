-- Migration: System stats RPC for /docs
-- Run this in your Supabase SQL editor.
--
-- Provides a single place to compute "how big is the DB right now?" numbers for:
-- - tracks, playlists, ingestion days
-- - distinct artists (derived from tracks arrays)
-- - estimated size of track_daily_streams (fast estimate)
--
-- Notes:
-- - `track_daily_streams` can be huge; use pg_class reltuples for a fast estimate.
-- - Distinct artists requires unnesting arrays; on ~10k tracks this is fine.

CREATE OR REPLACE FUNCTION public.spotibase_system_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH
    counts AS (
      SELECT
        (SELECT COUNT(*)::bigint FROM public.tracks) AS tracks,
        (SELECT COUNT(*)::bigint FROM public.playlists) AS playlists,
        (SELECT COUNT(*)::bigint FROM public.ingestion_runs) AS ingestion_days,
        (SELECT MAX(run_date) FROM public.ingestion_runs) AS as_of_run_date
    ),
    artists AS (
      SELECT COUNT(DISTINCT a.artist_id)::bigint AS artists_distinct
      FROM public.tracks t
      CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
      WHERE t.spotify_artist_ids IS NOT NULL
        AND a.artist_id IS NOT NULL
        AND length(a.artist_id) > 0
    ),
    est AS (
      SELECT
        COALESCE(
          (
            SELECT reltuples::bigint
            FROM pg_class
            WHERE oid = 'public.track_daily_streams'::regclass
          ),
          0::bigint
        ) AS track_daily_streams_rows_estimated
    )
  SELECT jsonb_build_object(
    'as_of_run_date', (SELECT as_of_run_date FROM counts),
    'ingestion_days', (SELECT ingestion_days FROM counts),
    'tracks', (SELECT tracks FROM counts),
    'playlists', (SELECT playlists FROM counts),
    'artists_distinct', (SELECT artists_distinct FROM artists),
    'track_daily_streams_rows_estimated', (SELECT track_daily_streams_rows_estimated FROM est)
  );
$$;

GRANT EXECUTE ON FUNCTION public.spotibase_system_stats() TO anon, authenticated;

