-- Persist Home "Tracks per milestone" custom milestones per user.
-- Stored as comma-separated stream milestone integers (streams, not USD).

alter table if exists user_settings
  add column if not exists home_custom_milestones_streams text null;

