-- Pin search_path on the one SECURITY DEFINER function that lacked it, so it
-- cannot resolve objects through a caller-controlled search_path
-- (Supabase Security Advisor: "Function Search Path Mutable").
-- All other SECURITY DEFINER functions in this repo already pin search_path
-- at definition time.

ALTER FUNCTION public.refresh_health_warning_history_mv() SET search_path = public, pg_temp;
