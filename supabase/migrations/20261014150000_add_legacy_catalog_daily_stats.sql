-- Archived (2023-07..2025-12) own-catalog daily totals, read by the Home "Archived history" toggle
-- (web/src/lib/home/loadHomeDashboard.ts). Service-role only (loaded and read server-side).
create table if not exists public.legacy_catalog_daily_stats (
  date date primary key,
  track_count integer not null,
  total_streams_cumulative bigint not null,
  daily_streams_net bigint check (daily_streams_net is null or daily_streams_net >= 0),
  reset_track_count integer not null default 0,
  missing_previous_track_count integer not null default 0,
  imported_at timestamptz not null default now()
);

alter table public.legacy_catalog_daily_stats enable row level security;

revoke all on public.legacy_catalog_daily_stats from anon, authenticated;
grant all on public.legacy_catalog_daily_stats to service_role;

comment on table public.legacy_catalog_daily_stats is
  'Recovered 2023-07-08..2025-12-22 catalog daily totals. daily_streams_net is null on partial/low-coverage days and excludes counter resets.';

notify pgrst, 'reload schema';
