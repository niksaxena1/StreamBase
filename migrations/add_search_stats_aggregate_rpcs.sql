-- Migration: Fast search hover stats (/api/search-stats)
-- Run this in your Supabase SQL editor.

-- Speed up contains() on artist ids (if not already present)
CREATE INDEX IF NOT EXISTS tracks_spotify_artist_ids_gin_idx
ON public.tracks
USING GIN (spotify_artist_ids);

-- Speed up lookups at specific snapshot dates
CREATE INDEX IF NOT EXISTS track_daily_streams_date_isrc_idx
ON public.track_daily_streams (date DESC, isrc);

-- Artist total streams at a given run_date (sum of that snapshot's cumulative values)
CREATE OR REPLACE FUNCTION public.artist_total_streams_for_date(
  artist_id TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.tracks t
  JOIN public.track_daily_streams s
    ON s.isrc = t.isrc
   AND s.date = $2
  WHERE t.spotify_artist_ids @> ARRAY[$1]::text[];
$$;

GRANT EXECUTE ON FUNCTION public.artist_total_streams_for_date(TEXT, DATE) TO anon, authenticated;

-- Playlist total streams at a given run_date (current memberships only; matches existing UI semantics)
CREATE OR REPLACE FUNCTION public.playlist_total_streams_for_date(
  playlist_key TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(s.streams_cumulative, 0)), 0)::bigint
  FROM public.playlist_memberships m
  JOIN public.track_daily_streams s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_to IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.playlist_total_streams_for_date(TEXT, DATE) TO anon, authenticated;

