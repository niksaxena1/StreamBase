-- Persist the preferred start date for time-series charts.
-- Stored as a DATE (YYYY-MM-DD). The app falls back to a default if NULL.

alter table if exists user_settings
  add column if not exists chart_start_date date null;

