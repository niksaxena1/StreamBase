-- Migration: Allow UI to read ingestion run status + warnings
-- Run this in your Supabase SQL Editor.
--
-- Why: The Next.js UI reads `ingestion_runs` and `ingestion_warnings` using the
-- Supabase JS client with the `authenticated` role (via `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
-- If the role is missing GRANTs and/or RLS SELECT policies, the UI will see
-- "Data ingestion status: unknown" even when data exists.
--
-- This migration is intentionally conservative:
-- - It GRANTs SELECT to `authenticated` (so PostgREST can read).
-- - If RLS is enabled on a table, it creates a permissive SELECT policy.
-- - It does NOT enable/disable RLS (to avoid surprising behavior changes).

-- Ensure the `authenticated` role can read these tables (required even if RLS is off).
grant select on table public.ingestion_runs to authenticated;
grant select on table public.ingestion_warnings to authenticated;

do $$
begin
  -- ingestion_runs: add SELECT policy only if RLS is enabled
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ingestion_runs'
      and c.relrowsecurity
  ) then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'ingestion_runs'
        and policyname = 'ingestion_runs_read_authenticated'
    ) then
      create policy ingestion_runs_read_authenticated
        on public.ingestion_runs
        for select
        to authenticated
        using (true);
    end if;
  end if;

  -- ingestion_warnings: add SELECT policy only if RLS is enabled
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ingestion_warnings'
      and c.relrowsecurity
  ) then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'ingestion_warnings'
        and policyname = 'ingestion_warnings_read_authenticated'
    ) then
      create policy ingestion_warnings_read_authenticated
        on public.ingestion_warnings
        for select
        to authenticated
        using (true);
    end if;
  end if;
end $$;

