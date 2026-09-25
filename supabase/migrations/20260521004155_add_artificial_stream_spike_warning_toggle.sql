-- Global switch for the Health-page artificial stream spike ingestion warning.
--
-- This does not hide the Home dashboard spike exploration section. It controls
-- whether daily ingestion emits `artificial_stream_spike` Health warnings.

INSERT INTO public.health_config (key, value_numeric, description)
VALUES (
  'artificial_streams_warning_enabled',
  1,
  'When 1, ingestion emits artificial_stream_spike Health warnings. Set to 0 to disable the warning while the detector is being redesigned.'
)
ON CONFLICT (key) DO NOTHING;
