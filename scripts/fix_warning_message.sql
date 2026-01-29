-- Fix the gahara_records_releases warning message to match actual data
-- This corrects the message from "10 track(s)" to "9 track(s)" based on current data

UPDATE ingestion_warnings
SET message = '9 track(s) in playlist have no catalog stream snapshot today'
WHERE code = 'non_catalog_tracks_present'
  AND playlist_key = 'gahara_records_releases'
  AND run_date = '2026-01-27';

-- Verify the update
SELECT 
  id,
  playlist_key,
  message,
  run_date,
  details_json
FROM ingestion_warnings
WHERE code = 'non_catalog_tracks_present'
  AND playlist_key = 'gahara_records_releases'
  AND run_date = '2026-01-27';
