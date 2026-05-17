ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS competitor_label_key TEXT;
