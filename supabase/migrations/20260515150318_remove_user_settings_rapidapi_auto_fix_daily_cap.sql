-- The scheduled stale-fix job now repairs all stale tracks below the fixed
-- 500-track safety threshold, so the old per-user daily cap is obsolete.

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS rapidapi_auto_fix_daily_cap;
