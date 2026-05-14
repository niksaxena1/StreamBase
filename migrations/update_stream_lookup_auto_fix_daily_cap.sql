-- Raise the stale-track auto-fix default now that the lookup uses
-- Beat Analytics first (50/day) and Music Metrics as fallback (20/day).

ALTER TABLE public.user_settings
  ALTER COLUMN rapidapi_auto_fix_daily_cap SET DEFAULT 70;

UPDATE public.user_settings
SET rapidapi_auto_fix_daily_cap = 70
WHERE rapidapi_auto_fix_daily_cap = 20;
