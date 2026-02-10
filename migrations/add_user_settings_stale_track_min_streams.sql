-- Configurable threshold for per-track stale stream detection.
-- Tracks with cumulative streams >= this value that show zero daily growth
-- will be flagged as "individual_tracks_stale" in ingestion warnings.
-- Default: 2000 (adjustable from Settings > Health).

alter table if exists user_settings
  add column if not exists stale_track_min_streams integer not null default 2000;
