-- Fix: stream_history_hot_from() was SECURITY INVOKER and reads *.track_streams_monthly, which anon/authenticated
-- cannot select. Every view that calls it (track_daily_streams_effective(_public), base_all, effective_hot) then
-- failed for anon (Ledgenta) and signed-in users with "permission denied for table track_streams_monthly".
-- It only returns a cutoff date, so run it as the owner with a fixed search_path.
-- (search_path is deliberately NOT pinned on the SQL range helpers: that would stop them being inlined.)
alter function public.stream_history_hot_from() security definer set search_path = public, pg_temp;
alter function competitor.stream_history_hot_from() security definer set search_path = competitor, pg_temp;
grant execute on function public.stream_history_hot_from() to anon, authenticated, service_role;
grant execute on function competitor.stream_history_hot_from() to anon, authenticated, service_role;

-- Competitor data is read server-side with the service role after admin gating; anon never needs these views
-- (they were readable by the anon key through the Data API).
revoke select on competitor.track_daily_streams_effective_public from anon;
revoke select on competitor.track_daily_streams_effective_hot from anon;
