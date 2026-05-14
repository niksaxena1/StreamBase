-- Persist stale-track stream lookup results so paid/provider calls are not
-- wasted if the Health page refreshes before overrides are applied.

CREATE TABLE IF NOT EXISTS public.stream_lookup_results (
  lookup_date date NOT NULL,
  isrc text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('beat_analytics', 'music_metrics')),
  streams bigint,
  status text NOT NULL CHECK (status IN ('ok', 'failed', 'suspicious')),
  error text,
  stale_streams bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lookup_date, isrc)
);

CREATE INDEX IF NOT EXISTS stream_lookup_results_lookup_date_idx
ON public.stream_lookup_results (lookup_date DESC);

ALTER TABLE public.stream_lookup_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stream_lookup_results FROM anon, authenticated;
