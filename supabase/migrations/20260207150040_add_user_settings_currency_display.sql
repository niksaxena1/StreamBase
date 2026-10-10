-- Persist preferred currency display mode.
-- All money values in the app are stored in USD; this setting affects formatting/conversion in the UI.

alter table if exists user_settings
  add column if not exists currency_display text not null default 'USD';

