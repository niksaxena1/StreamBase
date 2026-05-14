-- Scope cached stream lookup results by Health warning context so results
-- from one resolver do not appear in another warning category.

ALTER TABLE public.stream_lookup_results
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'stale'
  CHECK (context IN ('stale', 'missing_snapshot', 'prev_nonzero'));

ALTER TABLE public.stream_lookup_results
  DROP CONSTRAINT IF EXISTS stream_lookup_results_pkey;

ALTER TABLE public.stream_lookup_results
  ADD PRIMARY KEY (lookup_date, context, isrc);

CREATE INDEX IF NOT EXISTS stream_lookup_results_context_date_idx
ON public.stream_lookup_results (context, lookup_date DESC);
