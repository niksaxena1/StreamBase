-- Grant anon read-only access to the tables Ledgenta queries via its cross-project
-- SpotiBase integration (second Supabase client using the anon key).
--
-- Only SELECT is granted; no INSERT/UPDATE/DELETE.
-- RLS remains active on these tables — this grant only allows PostgREST to reach
-- the tables at all; row-level policies still apply if enabled.

GRANT SELECT ON public.track_daily_streams_effective_public TO anon;
GRANT SELECT ON public.tracks TO anon;
GRANT SELECT ON public.playlist_memberships TO anon;
GRANT SELECT ON public.playlists TO anon;
