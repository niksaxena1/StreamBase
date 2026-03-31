-- Home dashboard: show/hide same-weekday spikes section; optional per-user weekend preference for spike detection.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS home_artificial_spikes_section_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS artificial_streams_include_weekends_user boolean;

COMMENT ON COLUMN public.user_settings.home_artificial_spikes_section_enabled IS
  'When true, show the TRACKS: SAME-WEEKDAY SPIKES section on Home.';

COMMENT ON COLUMN public.user_settings.artificial_streams_include_weekends_user IS
  'If set, overrides health_config artificial_streams_include_weekends for Home spike detection; NULL means use health_config.';
