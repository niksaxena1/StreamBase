-- Weekly per-market Spotify availability scan for the own catalog.
--
-- scripts/scan_spotify_market_availability.py asks the Spotify Web API, market by
-- market, where each own-catalog track is NOT playable and records the result
-- here. Candidates come from the existing public.spotify_availability_candidates()
-- RPC (see 20261010203810_add_spotify_track_availability_watch.sql).
--
-- Written only by the pipeline (service role); the web app reads it with the
-- service-role client after admin gating (Health, Home, Catalog).

CREATE TABLE IF NOT EXISTS public.spotify_track_market_availability (
  isrc TEXT PRIMARY KEY REFERENCES public.tracks(isrc) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  markets_checked INT NOT NULL,
  available_count INT NOT NULL,
  unavailable_markets TEXT[] NOT NULL DEFAULT '{}',
  -- market -> restriction reason ("market", "none", "missing", ...)
  unavailable_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- true when Spotify relinked to another copy in at least one market (still playable)
  relinked BOOLEAN NOT NULL DEFAULT false,
  first_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  markets_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.spotify_track_market_availability IS
  'Latest per-market Spotify availability per own-catalog ISRC (weekly market scan).';

CREATE TABLE IF NOT EXISTS public.spotify_track_market_events (
  id BIGSERIAL PRIMARY KEY,
  isrc TEXT NOT NULL REFERENCES public.tracks(isrc) ON DELETE CASCADE,
  market TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('lost', 'gained')),
  reason TEXT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ NULL
);

COMMENT ON TABLE public.spotify_track_market_events IS
  'Per-market availability changes (lost/gained) detected by the weekly market scan (history + email audit).';

CREATE INDEX IF NOT EXISTS spotify_track_market_events_isrc_idx
  ON public.spotify_track_market_events (isrc, detected_at DESC);

CREATE INDEX IF NOT EXISTS spotify_track_market_events_detected_idx
  ON public.spotify_track_market_events (detected_at DESC);

ALTER TABLE public.spotify_track_market_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotify_track_market_events ENABLE ROW LEVEL SECURITY;

-- Backend-only. Web pages are admin-gated before their service-role reads.
REVOKE ALL ON public.spotify_track_market_availability FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.spotify_track_market_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.spotify_track_market_availability TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.spotify_track_market_events TO service_role;
REVOKE ALL ON SEQUENCE public.spotify_track_market_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.spotify_track_market_events_id_seq TO service_role;

-- Weekly dispatch (Sundays 21:00 UTC = 01:00 Dubai Monday). Idempotent: drop any
-- existing job of the same name first. Dispatch failures are emailed by
-- ops.check_workflow_dispatches().
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'streambase-market-availability';
  PERFORM cron.schedule(
    'streambase-market-availability',
    '0 21 * * 0',
    $c$select ops.dispatch_workflow('spotify_market_availability_weekly.yml')$c$
  );
END
$$;
