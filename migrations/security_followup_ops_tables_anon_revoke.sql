-- Follow-up: defense in depth — ensure PostgREST `anon` cannot read ingestion ops tables directly.
-- Authenticated users retain SELECT via existing grants/policies in add_ingestion_read_policies.sql.
-- Safe to run even if `anon` had no privileges (REVOKE is a no-op when nothing was granted).

REVOKE ALL ON TABLE public.ingestion_runs FROM anon;
REVOKE ALL ON TABLE public.ingestion_warnings FROM anon;
