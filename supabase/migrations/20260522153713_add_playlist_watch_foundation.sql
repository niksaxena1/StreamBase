-- Playlist Watch foundation.
-- Tracks daily Spotify playlist follower counts in an isolated schema.

CREATE SCHEMA IF NOT EXISTS playlist_watch;

CREATE TABLE IF NOT EXISTS public.app_user_access (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  own_catalog BOOLEAN NOT NULL DEFAULT FALSE,
  competitor BOOLEAN NOT NULL DEFAULT FALSE,
  playlist_watch BOOLEAN NOT NULL DEFAULT FALSE,
  playlist_watch_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.app_user_access_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_user_access_updated_at ON public.app_user_access;
CREATE TRIGGER trg_app_user_access_updated_at
  BEFORE UPDATE ON public.app_user_access
  FOR EACH ROW EXECUTE FUNCTION public.app_user_access_set_updated_at();

ALTER TABLE public.app_user_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own app access" ON public.app_user_access;
CREATE POLICY "Users can read own app access"
  ON public.app_user_access
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage app access" ON public.app_user_access;
CREATE POLICY "Admins can manage app access"
  ON public.app_user_access
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.can_access_playlist_watch()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_admin(), FALSE)
    OR EXISTS (
      SELECT 1
      FROM public.app_user_access a
      WHERE a.user_id = auth.uid()
        AND a.playlist_watch IS TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.is_playlist_watch_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_admin(), FALSE)
    OR EXISTS (
      SELECT 1
      FROM public.app_user_access a
      WHERE a.user_id = auth.uid()
        AND a.playlist_watch_admin IS TRUE
    );
$$;

CREATE TABLE IF NOT EXISTS playlist_watch.playlists (
  spotify_playlist_id TEXT PRIMARY KEY,
  display_name TEXT,
  owner_spotify_id TEXT,
  owner_display_name TEXT,
  spotify_url TEXT,
  image_url TEXT,
  watch_status TEXT NOT NULL DEFAULT 'active'
    CHECK (watch_status IN ('active', 'archived')),
  last_check_status TEXT
    CHECK (last_check_status IS NULL OR last_check_status IN ('ok', 'spotify_404', 'unavailable', 'rate_limited')),
  last_check_message TEXT,
  latest_follower_count BIGINT,
  latest_snapshot_date DATE,
  latest_checked_at TIMESTAMPTZ,
  first_tracked_date DATE,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_watch.ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'spotify_api',
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  attempted_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  warnings_count INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT,
  logs_url TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS playlist_watch.follower_snapshots (
  date DATE NOT NULL,
  spotify_playlist_id TEXT NOT NULL REFERENCES playlist_watch.playlists(spotify_playlist_id) ON DELETE CASCADE,
  follower_count BIGINT NOT NULL CHECK (follower_count >= 0),
  source TEXT NOT NULL DEFAULT 'spotify_api',
  source_run_id BIGINT REFERENCES playlist_watch.ingestion_runs(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, spotify_playlist_id)
);

CREATE TABLE IF NOT EXISTS playlist_watch.ingestion_warnings (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES playlist_watch.ingestion_runs(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  spotify_playlist_id TEXT REFERENCES playlist_watch.playlists(spotify_playlist_id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_watch.user_playlist_marks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT NOT NULL REFERENCES playlist_watch.playlists(spotify_playlist_id) ON DELETE CASCADE,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, spotify_playlist_id)
);

CREATE OR REPLACE FUNCTION playlist_watch.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_playlist_watch_playlists_updated_at ON playlist_watch.playlists;
CREATE TRIGGER trg_playlist_watch_playlists_updated_at
  BEFORE UPDATE ON playlist_watch.playlists
  FOR EACH ROW EXECUTE FUNCTION playlist_watch.set_updated_at();

DROP TRIGGER IF EXISTS trg_playlist_watch_user_marks_updated_at ON playlist_watch.user_playlist_marks;
CREATE TRIGGER trg_playlist_watch_user_marks_updated_at
  BEFORE UPDATE ON playlist_watch.user_playlist_marks
  FOR EACH ROW EXECUTE FUNCTION playlist_watch.set_updated_at();

CREATE INDEX IF NOT EXISTS playlist_watch_playlists_status_name_idx
  ON playlist_watch.playlists (watch_status, display_name);

CREATE INDEX IF NOT EXISTS playlist_watch_snapshots_playlist_date_idx
  ON playlist_watch.follower_snapshots (spotify_playlist_id, date DESC);

CREATE INDEX IF NOT EXISTS playlist_watch_snapshots_date_idx
  ON playlist_watch.follower_snapshots (date DESC);

CREATE INDEX IF NOT EXISTS playlist_watch_user_marks_favorites_idx
  ON playlist_watch.user_playlist_marks (user_id, is_favorite)
  WHERE is_favorite IS TRUE;

CREATE INDEX IF NOT EXISTS playlist_watch_runs_date_idx
  ON playlist_watch.ingestion_runs (run_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS playlist_watch_warnings_run_idx
  ON playlist_watch.ingestion_warnings (run_id, spotify_playlist_id);

ALTER TABLE playlist_watch.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.follower_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.ingestion_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.user_playlist_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages playlist watch playlists"
  ON playlist_watch.playlists
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role manages playlist watch runs"
  ON playlist_watch.ingestion_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role manages playlist watch snapshots"
  ON playlist_watch.follower_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role manages playlist watch warnings"
  ON playlist_watch.ingestion_warnings
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role manages playlist watch marks"
  ON playlist_watch.user_playlist_marks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT USAGE ON SCHEMA playlist_watch TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA playlist_watch TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA playlist_watch TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA playlist_watch TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA playlist_watch GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA playlist_watch GRANT ALL ON ROUTINES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA playlist_watch GRANT ALL ON SEQUENCES TO service_role;

GRANT EXECUTE ON FUNCTION public.can_access_playlist_watch() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_playlist_watch_admin() TO authenticated, service_role;

ALTER ROLE authenticator
SET pgrst.db_schemas = 'public, graphql_public, competitor, playlist_watch';

NOTIFY pgrst, 'reload config';
