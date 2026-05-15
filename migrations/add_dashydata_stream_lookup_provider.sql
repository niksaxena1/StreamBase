-- Add DashyData as a monthly stream lookup provider.

ALTER TABLE public.stream_lookup_usage
  DROP CONSTRAINT IF EXISTS stream_lookup_usage_provider_check;

ALTER TABLE public.stream_lookup_usage
  ADD CONSTRAINT stream_lookup_usage_provider_check
  CHECK (provider IN ('dashydata', 'music_analytics', 'checkleakedcc', 'beat_analytics', 'music_metrics'));

ALTER TABLE public.stream_lookup_results
  DROP CONSTRAINT IF EXISTS stream_lookup_results_provider_check;

ALTER TABLE public.stream_lookup_results
  ADD CONSTRAINT stream_lookup_results_provider_check
  CHECK (provider IN ('dashydata', 'music_analytics', 'checkleakedcc', 'beat_analytics', 'music_metrics'));
