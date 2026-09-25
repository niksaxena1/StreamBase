-- Track app-side stream lookup usage by provider so manual and scheduled
-- stale-track fixes can avoid exceeding free-tier provider quotas.

CREATE TABLE IF NOT EXISTS public.stream_lookup_usage (
  usage_date date NOT NULL,
  provider text NOT NULL CHECK (provider IN ('beat_analytics', 'music_metrics')),
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, provider)
);

ALTER TABLE public.stream_lookup_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stream_lookup_usage FROM anon, authenticated;
