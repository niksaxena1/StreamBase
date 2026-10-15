-- OWNER PASTE. The migration 20261015013500_add_stream_source_quality.sql was applied through the MCP, but the
-- "revoke ... from anon, authenticated" on public.stream_consolidation_rejects was declined by the connector
-- guard. RLS is enabled with no policies, so the table returns no rows to anon/authenticated, but the Data API
-- grants should still be removed (this table is service_role only).
revoke all on table public.stream_consolidation_rejects from anon, authenticated;

-- Check (expect only postgres, service_role and the read-only role):
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'stream_consolidation_rejects' order by 1, 2;
