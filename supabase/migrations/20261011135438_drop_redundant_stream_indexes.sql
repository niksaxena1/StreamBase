-- Free ~148 MB (project is over the Free-plan 500 MB database size).
-- No data is deleted; only redundant/unused indexes are dropped.
--
-- * (date DESC, isrc) duplicates the (date, isrc) primary key: a btree scans in
--   either direction, and lookups/ranges on date (+isrc) use the pkey.
-- * source_run_id indexes were scanned once since January (re-ingest cleanup);
--   that rare delete can scan a single monthly partition instead.
-- * Override (date) indexes duplicate the leading column of the unique
--   (date, isrc) index.
-- Dropping a partitioned parent index drops its partition indexes too.

drop index if exists public.track_daily_streams_date_isrc_idx;
drop index if exists competitor.competitor_track_daily_streams_date_isrc_idx;
drop index if exists competitor.competitor_track_daily_streams_source_run_id_idx;
drop index if exists public.track_daily_stream_overrides_date_idx;
drop index if exists competitor.competitor_track_daily_stream_overrides_date_idx;
