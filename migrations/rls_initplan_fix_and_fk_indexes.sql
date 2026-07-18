-- Applied to prod 2026-07-18 via Supabase MCP (migration name:
-- rls_initplan_fix_and_fk_indexes).
--
-- Perf advisor fixes:
-- 1) auth_rls_initplan (23 policies): wrapped auth.uid()/auth.role() calls in
--    scalar subqueries — e.g. `user_id = auth.uid()` becomes
--    `user_id = (select auth.uid())` — so the function evaluates once per
--    statement instead of once per row. Applied via ALTER POLICY to
--    app_admins, sai_conversations, sai_messages, user_settings,
--    saved_filters, app_user_access, and all playlist_watch.* policies.
--    Semantics unchanged.
-- 2) unindexed_foreign_keys on hot paths:

CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_run_id ON public.ingestion_warnings (run_id);
CREATE INDEX IF NOT EXISTS idx_isrc_aliases_canonical_isrc ON public.isrc_aliases (canonical_isrc);

-- To regenerate the exact ALTER POLICY list, run the pg_policies query in
-- supabase_migrations history for this migration name.
