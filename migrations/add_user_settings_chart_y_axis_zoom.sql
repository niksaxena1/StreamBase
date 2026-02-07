-- Persist preferences for "zoomed" Y-axis domains on daily charts.
-- When enabled, daily charts use a padded min/max domain instead of a 0 baseline.

alter table if exists user_settings
  add column if not exists chart_zoom_daily_y_axis boolean not null default true;

alter table if exists user_settings
  add column if not exists chart_zoom_daily_y_axis_collector_comparison boolean not null default true;

