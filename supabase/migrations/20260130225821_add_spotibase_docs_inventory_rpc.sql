-- Migration: DB inventory RPC for /docs
-- Run this in your Supabase SQL editor.
--
-- Purpose:
-- - Provide a machine-readable snapshot of the *current* database objects used by SpotiBase.
-- - This is useful for:
--   - documentation automation
--   - debugging "did we apply the migrations?"
--   - SAI/RAG grounding (schema + RPC list)
--
-- Notes:
-- - This returns public schema tables/views/columns and public functions.
-- - Large DBs: this is still relatively small, but keep it cached in the app (we do).

CREATE OR REPLACE FUNCTION public.spotibase_docs_inventory()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH
    cols AS (
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
    ),
    tables AS (
      SELECT
        t.table_name,
        jsonb_agg(
          jsonb_build_object(
            'name', c.column_name,
            'type', c.data_type,
            'nullable', (c.is_nullable = 'YES')
          )
          ORDER BY c.ordinal_position
        ) AS columns
      FROM (SELECT DISTINCT table_name FROM cols) t
      JOIN cols c ON c.table_name = t.table_name
      GROUP BY t.table_name
      ORDER BY t.table_name
    ),
    views AS (
      SELECT jsonb_agg(v.table_name ORDER BY v.table_name) AS names
      FROM information_schema.views v
      WHERE v.table_schema = 'public'
    ),
    funcs AS (
      SELECT
        p.proname::text AS name,
        pg_get_function_identity_arguments(p.oid)::text AS args,
        pg_get_function_result(p.oid)::text AS returns,
        p.provolatile::text AS volatility
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname NOT LIKE 'pg_%'
      ORDER BY p.proname
    )
  SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', table_name, 'columns', columns) ORDER BY table_name) FROM tables), '[]'::jsonb),
    'views', COALESCE((SELECT names FROM views), '[]'::jsonb),
    'functions', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'args', args, 'returns', returns, 'volatility', volatility) ORDER BY name) FROM funcs), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.spotibase_docs_inventory() TO anon, authenticated;

