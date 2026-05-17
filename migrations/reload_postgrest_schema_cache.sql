-- Refresh PostgREST after changing exposed schemas and competitor object grants.

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
