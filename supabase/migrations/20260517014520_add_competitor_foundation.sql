-- Competitor tracking foundation.
-- Keeps competitor analytics isolated from the own-catalog public schema.

CREATE SCHEMA IF NOT EXISTS competitor;

CREATE TABLE IF NOT EXISTS competitor.labels (
  label_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor.playlists (
  playlist_key TEXT PRIMARY KEY,
  label_key TEXT NOT NULL REFERENCES competitor.labels(label_key),
  display_name TEXT NOT NULL,
  spotify_playlist_id TEXT,
  spotify_playlist_image_url TEXT,
  sot_playlist_id BIGINT,
  sot_dashboard_url TEXT NOT NULL,
  display_order INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor.tracks (
  isrc TEXT PRIMARY KEY,
  name TEXT,
  spotify_track_id TEXT,
  spotify_artist_ids TEXT[],
  spotify_artist_names TEXT[],
  spotify_album_image_url TEXT,
  release_date DATE,
  first_seen DATE,
  last_seen DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor.ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  commit_sha TEXT,
  logs_url TEXT,
  exports_prefix TEXT
);

CREATE TABLE IF NOT EXISTS competitor.raw_exports (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES competitor.ingestion_runs(id) ON DELETE CASCADE,
  playlist_key TEXT NOT NULL REFERENCES competitor.playlists(playlist_key),
  storage_bucket TEXT,
  storage_prefix TEXT,
  object_key TEXT NOT NULL,
  rows_count INTEGER NOT NULL DEFAULT 0,
  file_sha256 TEXT,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor.ingestion_warnings (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES competitor.ingestion_runs(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  playlist_key TEXT REFERENCES competitor.playlists(playlist_key),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor.track_daily_streams (
  date DATE NOT NULL,
  isrc TEXT NOT NULL REFERENCES competitor.tracks(isrc),
  streams_cumulative BIGINT,
  est_revenue_total NUMERIC,
  source_run_id BIGINT REFERENCES competitor.ingestion_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, isrc)
) PARTITION BY RANGE (date);

CREATE TABLE IF NOT EXISTS competitor.playlist_memberships (
  id BIGSERIAL PRIMARY KEY,
  playlist_key TEXT NOT NULL REFERENCES competitor.playlists(playlist_key),
  isrc TEXT NOT NULL REFERENCES competitor.tracks(isrc),
  valid_from DATE NOT NULL,
  valid_to DATE,
  CONSTRAINT competitor_playlist_memberships_valid_range
    CHECK (valid_to IS NULL OR valid_from <= valid_to)
);

CREATE TABLE IF NOT EXISTS competitor.playlist_daily_stats (
  date DATE NOT NULL,
  playlist_key TEXT NOT NULL REFERENCES competitor.playlists(playlist_key),
  track_count INTEGER,
  total_streams_cumulative BIGINT,
  daily_streams_net BIGINT,
  est_revenue_total NUMERIC,
  est_revenue_daily_net NUMERIC,
  missing_streams_track_count INTEGER,
  source_run_id BIGINT REFERENCES competitor.ingestion_runs(id),
  PRIMARY KEY (date, playlist_key)
);

CREATE INDEX IF NOT EXISTS competitor_track_daily_streams_isrc_date_idx
  ON competitor.track_daily_streams (isrc, date DESC);

CREATE INDEX IF NOT EXISTS competitor_track_daily_streams_date_isrc_idx
  ON competitor.track_daily_streams (date DESC, isrc);

CREATE INDEX IF NOT EXISTS competitor_playlist_memberships_current_idx
  ON competitor.playlist_memberships (playlist_key, valid_from DESC)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS competitor_playlist_memberships_removed_idx
  ON competitor.playlist_memberships (playlist_key, valid_to DESC)
  WHERE valid_to IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlist_memberships_active_uq
  ON competitor.playlist_memberships (playlist_key, isrc)
  WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION competitor.ensure_track_daily_streams_partitions(months_ahead INTEGER DEFAULT 6)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  m DATE;
  partition_name TEXT;
BEGIN
  FOR m IN
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + make_interval(months => GREATEST(months_ahead, 0)))::date,
      INTERVAL '1 month'
    )::date
  LOOP
    partition_name := 'track_daily_streams_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS competitor.%I PARTITION OF competitor.track_daily_streams FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      m,
      (m + INTERVAL '1 month')::date
    );
  END LOOP;
END;
$$;

SELECT competitor.ensure_track_daily_streams_partitions(6);

INSERT INTO competitor.labels (label_key, display_name)
VALUES ('paraiso', 'Paraíso')
ON CONFLICT (label_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  updated_at = NOW();

INSERT INTO competitor.playlists (
  playlist_key,
  label_key,
  display_name,
  spotify_playlist_id,
  sot_playlist_id,
  sot_dashboard_url,
  display_order
) VALUES (
  'paraiso_releases',
  'paraiso',
  'Paraíso Releases',
  '2RGHAxvb8iosGgP6pd7GFK',
  8948445,
  'https://www.spotontrack.com/dashboard/8609',
  0
)
ON CONFLICT (playlist_key) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  display_name = EXCLUDED.display_name,
  spotify_playlist_id = EXCLUDED.spotify_playlist_id,
  sot_playlist_id = EXCLUDED.sot_playlist_id,
  sot_dashboard_url = EXCLUDED.sot_dashboard_url,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- Private schema: service-role only for now. No anon/authenticated grants.

-- Verification checklist after apply:
-- select to_regclass('competitor.labels');
-- select to_regclass('competitor.playlists');
-- select to_regclass('competitor.tracks');
-- select to_regclass('competitor.track_daily_streams');
-- select to_regclass('competitor.playlist_memberships');
-- select to_regclass('competitor.playlist_daily_stats');
-- select label_key, display_name from competitor.labels where label_key = 'paraiso';
-- select playlist_key, label_key from competitor.playlists where playlist_key = 'paraiso_releases';
