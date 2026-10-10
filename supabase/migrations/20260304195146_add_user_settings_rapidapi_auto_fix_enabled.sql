-- Allow users to disable the scheduled RapidAPI auto-fix for stale tracks.
-- Defaults to true so existing behaviour is preserved for all users.
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS rapidapi_auto_fix_enabled boolean NOT NULL DEFAULT true;
