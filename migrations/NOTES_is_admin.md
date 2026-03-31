# `public.is_admin()` dependency

Several migrations and RLS policies call `public.is_admin()` (for example `health_config`, `health_warning_exclusions` after [security_hardening_revoke_anon_execute_and_rls.sql](security_hardening_revoke_anon_execute_and_rls.sql)).

This repository does **not** ship a canonical `is_admin` implementation because it is environment-specific (single admin email, JWT claims, or an admin table).

**Before applying migrations that reference `is_admin()` on a fresh database**, create the function in the Supabase SQL editor to match your production behavior. Example patterns:

1. **JWT app metadata** (if you set `app_metadata.role = 'admin'` for admin users):

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
```

2. **Allowlist table** (replace with your table/column names):

```sql
-- Example only — adjust schema to your project.
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users u WHERE u.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
```

After the function exists, apply migrations that reference `is_admin()`.
