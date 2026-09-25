-- Expose the competitor schema through Supabase Data API/PostgREST.
-- Object grants still keep competitor tables and routines service-role-only.

ALTER ROLE authenticator
SET pgrst.db_schemas = 'public, graphql_public, competitor';

NOTIFY pgrst, 'reload config';
