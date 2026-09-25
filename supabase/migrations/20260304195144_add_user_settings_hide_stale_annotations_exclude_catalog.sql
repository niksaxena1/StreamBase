-- Allow users to exclude the /catalog page from the "hide stale-fix annotations" behaviour.
-- When false (default), catalog is included in the hiding (preserves existing behaviour).
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS hide_stale_annotations_exclude_catalog boolean NOT NULL DEFAULT false;
