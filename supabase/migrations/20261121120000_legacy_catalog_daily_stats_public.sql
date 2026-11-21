-- Read-only view of the archived (2023-07..2025-12) own-catalog daily totals, so Ledgenta's
-- dashboard StreamBase Comparison can draw pre-2026 history as a dashed "legacy" line.
-- Same exposure as playlist_daily_stats_public (which already serves all_catalog totals to anon).
create or replace view public.legacy_catalog_daily_stats_public as
select date, total_streams_cumulative, daily_streams_net
from public.legacy_catalog_daily_stats;

revoke all on public.legacy_catalog_daily_stats_public from anon, authenticated;
grant select on public.legacy_catalog_daily_stats_public to anon, authenticated;
grant all on public.legacy_catalog_daily_stats_public to service_role;

comment on view public.legacy_catalog_daily_stats_public is
  'Archived catalog daily totals (2023-07-08..2025-12-22) for Ledgenta. daily_streams_net is null on partial/low-coverage days and excludes counter resets.';

notify pgrst, 'reload schema';
