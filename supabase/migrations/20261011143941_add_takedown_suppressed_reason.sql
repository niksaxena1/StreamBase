ALTER TABLE public.spotify_track_availability_events
  ADD COLUMN IF NOT EXISTS suppressed_reason TEXT;

COMMENT ON COLUMN public.spotify_track_availability_events.suppressed_reason IS
  'Why an availability event was marked notified without sending an email.';
