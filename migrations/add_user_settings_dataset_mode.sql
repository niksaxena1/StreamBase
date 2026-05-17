ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS dataset_mode TEXT NOT NULL DEFAULT 'own';

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_dataset_mode_check;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_dataset_mode_check
  CHECK (dataset_mode IN ('own', 'competitor'));
