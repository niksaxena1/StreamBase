-- Add setting to hide chart annotations for stale-track overrides.
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS hide_stale_override_annotations boolean NOT NULL DEFAULT false;
