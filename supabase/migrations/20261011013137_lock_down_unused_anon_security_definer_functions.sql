-- Lock down SECURITY DEFINER functions that anyone holding the public anon key
-- could call. None of them is used by the StreamBase app, its pipelines, or
-- Ledgenta's StreamBase client (which only reads the *_public views and
-- get_chart_week_highlight_day_for_email; those stay anon-readable).
-- Ledgenta calls its own copies of the revenue/statement functions in its own
-- database, not these.
--
-- Postgres grants EXECUTE to PUBLIC by default, so revoke from PUBLIC too.

-- Write/heavy functions: service_role only.
revoke execute on function public.delete_upload_cascade(uuid) from public, anon, authenticated, claw_spotibase_readonly;
revoke execute on function public.refresh_analytics_views() from public, anon, authenticated, claw_spotibase_readonly;

-- Legacy revenue/statement reads (backing tables are empty here): keep for
-- service_role and the read-only reporting role, remove from anon/authenticated.
revoke execute on function public.get_track_revenue_breakdown(text, date, date) from public, anon, authenticated;
revoke execute on function public.get_track_spotify_collector_months(text, date, date) from public, anon, authenticated;
revoke execute on function public.get_statement_coverage_matrix() from public, anon, authenticated;
revoke execute on function public.get_statement_coverage_matrix_year(integer) from public, anon, authenticated;
revoke execute on function public.get_statement_coverage_years() from public, anon, authenticated;
revoke execute on function public.get_collector_stats_with_spotify_date(text, text) from public, anon, authenticated;

grant execute on function public.delete_upload_cascade(uuid) to service_role;
grant execute on function public.refresh_analytics_views() to service_role;

-- Pin search_path (advisor: function_search_path_mutable). Body only uses
-- schema-qualified competitor.* tables.
alter function competitor.scoped_isrcs_for_label(text, date) set search_path = competitor, pg_temp;
