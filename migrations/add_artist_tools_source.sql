-- Apply after add_track_daily_stream_overrides.sql. Own catalog only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artist_tools_oauth (
  id text PRIMARY KEY,
  client_id text,
  client_secret text,
  token_endpoint text,
  access_token text,
  access_token_expires_at timestamptz,
  refresh_token text,
  refresh_token_obtained_at timestamptz,
  lock_owner text,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.artist_tools_oauth IS
  'SECRET: OAuth client credentials and rotating artist.tools tokens. Service role only; never expose via app or logs.';

CREATE TABLE IF NOT EXISTS public.artist_tools_saved_tracks (
  spotify_track_id text PRIMARY KEY,
  isrc text,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.artist_tools_track_streams (
  date date NOT NULL,
  spotify_track_id text NOT NULL,
  isrc text NOT NULL,
  streams bigint NOT NULL CHECK (streams >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, spotify_track_id)
);
CREATE INDEX IF NOT EXISTS artist_tools_track_streams_isrc_date_idx
  ON public.artist_tools_track_streams (isrc, date);

CREATE TABLE IF NOT EXISTS public.artist_tools_runs (
  run_date date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  runner text NOT NULL CHECK (runner IN ('github', 'pc', 'manual')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  added_count integer NOT NULL DEFAULT 0,
  observed_count integer NOT NULL DEFAULT 0,
  fixed_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.artist_tools_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_tools_saved_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_tools_track_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_tools_runs ENABLE ROW LEVEL SECURITY;
-- Supabase default privileges can grant API roles access on table creation.
REVOKE ALL ON public.artist_tools_oauth, public.artist_tools_saved_tracks,
  public.artist_tools_track_streams, public.artist_tools_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.artist_tools_oauth, public.artist_tools_saved_tracks,
  public.artist_tools_track_streams, public.artist_tools_runs TO service_role;
-- Deliberately no RLS policies: these tables are backend-only.
COMMIT;
