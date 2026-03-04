-- Allow users to configure the daily cap for the RapidAPI auto-fix job.
-- Defaults to 20 (the previous hardcoded value). Max 1000.
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS rapidapi_auto_fix_daily_cap integer NOT NULL DEFAULT 20
  CONSTRAINT rapidapi_auto_fix_daily_cap_range CHECK (rapidapi_auto_fix_daily_cap BETWEEN 1 AND 1000);
