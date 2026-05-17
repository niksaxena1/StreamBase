-- Harden competitor schema for the service-role-only access model.
-- Keeps PostgREST access available to server-side service-role clients without
-- granting direct anon/authenticated access to competitor data or routines.

CREATE OR REPLACE FUNCTION competitor.playlist_current_tracks(
  playlist_key TEXT,
  run_date DATE
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC;
$$;

CREATE OR REPLACE FUNCTION competitor.playlist_removed_tracks(
  playlist_key TEXT,
  limit_rows INT DEFAULT 500
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  valid_to DATE
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    m.valid_to::date AS valid_to
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  WHERE m.playlist_key = $1
    AND m.valid_to IS NOT NULL
  ORDER BY m.valid_to DESC, name ASC
  LIMIT GREATEST(COALESCE($2, 500), 0);
$$;

CREATE OR REPLACE FUNCTION competitor.playlist_top_tracks_total(
  playlist_key TEXT,
  run_date DATE,
  limit_rows INT DEFAULT 200
)
RETURNS TABLE (
  isrc TEXT,
  name TEXT,
  album_image_url TEXT,
  artist_names TEXT[],
  artist_ids TEXT[],
  valid_from DATE,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.isrc,
    COALESCE(t.name, m.isrc)::text AS name,
    t.spotify_album_image_url::text AS album_image_url,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    m.valid_from::date AS valid_from,
    s.streams_cumulative::bigint AS total
  FROM competitor.playlist_memberships m
  LEFT JOIN competitor.tracks t USING (isrc)
  LEFT JOIN competitor.track_daily_streams s
    ON s.isrc = m.isrc
   AND s.date = $2
  WHERE m.playlist_key = $1
    AND m.valid_from <= $2
    AND (m.valid_to IS NULL OR m.valid_to >= $2)
  ORDER BY total DESC NULLS LAST, name ASC
  LIMIT GREATEST(COALESCE($3, 200), 0);
$$;

ALTER TABLE competitor.labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.raw_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.ingestion_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.track_daily_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.playlist_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor.playlist_daily_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA competitor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA competitor TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA competitor TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA competitor TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA competitor TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
GRANT ALL ON ROUTINES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
GRANT ALL ON SEQUENCES TO service_role;
