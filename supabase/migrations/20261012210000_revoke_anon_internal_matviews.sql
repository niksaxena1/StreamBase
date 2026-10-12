-- Security advisor (materialized_view_in_api): these summaries were readable with the public anon key.
-- The app reads them server-side with the service role (api/health-history, api/competitor-health-history);
-- collector_stats_overview_mv has no app reader. Ledgenta only uses the *_effective_public views.
revoke select on public.collector_stats_overview_mv from anon;
revoke select on public.health_warning_history_mv from anon;
