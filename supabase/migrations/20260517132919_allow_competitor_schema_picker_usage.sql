-- Supabase Dashboard's Data API schema picker expects API roles to have
-- schema-level USAGE. Keep all competitor data and routines service-role-only.

GRANT USAGE ON SCHEMA competitor TO anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA competitor FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA competitor
REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
