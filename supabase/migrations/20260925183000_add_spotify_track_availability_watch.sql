-- Spotify takedown watch for the own catalog.
--
-- SpotOnTrack data lags ~2 days, so a track that Spotify takes down (DMCA /
-- infringement report, distributor takedown, ...) only shows up in StreamBase
-- days later. scripts/check_spotify_track_availability.py asks the Spotify Web
-- API directly once a day and records the result here; transitions to
-- "unavailable" (and back) are logged as events and emailed.
--
-- Written only by the pipeline (service role); the web app reads it with the
-- service-role client after admin gating on /health.

CREATE TABLE IF NOT EXISTS public.spotify_track_availability (
  isrc TEXT PRIMARY KEY REFERENCES public.tracks(isrc) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  -- e.g. not_found, not_playable, not_playable:market, isrc_search_miss, relinked:<id>
  reason TEXT NULL,
  markets_checked TEXT[] NOT NULL DEFAULT '{}',
  first_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_available_at TIMESTAMPTZ NULL,
  unavailable_since TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.spotify_track_availability IS
  'Latest Spotify Web API availability per own-catalog ISRC (daily takedown watch).';

CREATE INDEX IF NOT EXISTS spotify_track_availability_unavailable_idx
  ON public.spotify_track_availability (unavailable_since DESC)
  WHERE status = 'unavailable';

CREATE TABLE IF NOT EXISTS public.spotify_track_availability_events (
  id BIGSERIAL PRIMARY KEY,
  isrc TEXT NOT NULL REFERENCES public.tracks(isrc) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('taken_down', 'restored')),
  reason TEXT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.spotify_track_availability_events IS
  'Availability transitions detected by the Spotify takedown watch (history + email audit).';

CREATE INDEX IF NOT EXISTS spotify_track_availability_events_isrc_idx
  ON public.spotify_track_availability_events (isrc, detected_at DESC);

CREATE INDEX IF NOT EXISTS spotify_track_availability_events_detected_idx
  ON public.spotify_track_availability_events (detected_at DESC);

ALTER TABLE public.spotify_track_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotify_track_availability_events ENABLE ROW LEVEL SECURITY;

-- Backend-only: no anon/authenticated access (no policies => denied under RLS).
REVOKE ALL ON public.spotify_track_availability FROM anon, authenticated;
REVOKE ALL ON public.spotify_track_availability_events FROM anon, authenticated;
GRANT ALL ON public.spotify_track_availability TO service_role;
GRANT ALL ON public.spotify_track_availability_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.spotify_track_availability_events_id_seq TO service_role;

-- Own-catalog tracks to check: every ISRC with a catalog snapshot
-- (track_daily_streams) in the last p_lookback_days, plus its latest
-- cumulative streams for context in alerts. Tracks without a Spotify id are
-- returned too (spotify_track_id NULL) so the script can report them.
CREATE OR REPLACE FUNCTION public.spotify_availability_candidates(
  p_lookback_days INT DEFAULT 30
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  spotify_track_id TEXT,
  artist_names TEXT[],
  album_image_url TEXT,
  last_catalog_date DATE,
  streams_cumulative BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.isrc)
      s.isrc,
      s.date,
      s.streams_cumulative
    FROM public.track_daily_streams s
    WHERE s.date >= CURRENT_DATE - GREATEST(1, p_lookback_days)
    ORDER BY s.isrc, s.date DESC
  )
  SELECT
    l.isrc,
    t.name,
    t.spotify_track_id,
    t.spotify_artist_names,
    t.spotify_album_image_url,
    l.date,
    l.streams_cumulative::BIGINT
  FROM latest l
  JOIN public.tracks t ON t.isrc = l.isrc
  ORDER BY l.isrc;
$$;

REVOKE ALL ON FUNCTION public.spotify_availability_candidates(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spotify_availability_candidates(INT) TO service_role;
