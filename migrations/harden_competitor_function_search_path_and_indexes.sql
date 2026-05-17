-- Resolve Supabase advisor warnings for competitor functions and foreign keys.

ALTER FUNCTION competitor.ensure_track_daily_streams_partitions(integer) SET search_path = '';
ALTER FUNCTION competitor.playlists_latest_track_counts(text[]) SET search_path = '';
ALTER FUNCTION competitor.playlist_current_tracks(text, date) SET search_path = '';
ALTER FUNCTION competitor.playlist_removed_tracks(text, integer) SET search_path = '';
ALTER FUNCTION competitor.playlist_top_tracks_total(text, date, integer) SET search_path = '';
ALTER FUNCTION competitor.catalog_artist_series(text, date, date) SET search_path = '';
ALTER FUNCTION competitor.catalog_artist_top_tracks_total(text, date, integer) SET search_path = '';
ALTER FUNCTION competitor.catalog_artist_top_tracks_daily(text, date, integer) SET search_path = '';
ALTER FUNCTION competitor.search_all(text, integer) SET search_path = '';

DO $$
DECLARE
  partition_regclass regclass;
BEGIN
  FOR partition_regclass IN
    SELECT inhrelid::regclass
    FROM pg_inherits
    WHERE inhparent = 'competitor.track_daily_streams'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', partition_regclass);
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS competitor_playlists_label_key_idx
  ON competitor.playlists (label_key);

CREATE INDEX IF NOT EXISTS competitor_ingestion_warnings_run_id_idx
  ON competitor.ingestion_warnings (run_id);

CREATE INDEX IF NOT EXISTS competitor_ingestion_warnings_playlist_key_idx
  ON competitor.ingestion_warnings (playlist_key);

CREATE INDEX IF NOT EXISTS competitor_raw_exports_run_id_idx
  ON competitor.raw_exports (run_id);

CREATE INDEX IF NOT EXISTS competitor_raw_exports_playlist_key_idx
  ON competitor.raw_exports (playlist_key);

CREATE INDEX IF NOT EXISTS competitor_playlist_daily_stats_playlist_date_idx
  ON competitor.playlist_daily_stats (playlist_key, date DESC);

CREATE INDEX IF NOT EXISTS competitor_playlist_daily_stats_source_run_id_idx
  ON competitor.playlist_daily_stats (source_run_id);

CREATE INDEX IF NOT EXISTS competitor_playlist_memberships_isrc_idx
  ON competitor.playlist_memberships (isrc);

CREATE INDEX IF NOT EXISTS competitor_track_daily_streams_source_run_id_idx
  ON competitor.track_daily_streams (source_run_id);
