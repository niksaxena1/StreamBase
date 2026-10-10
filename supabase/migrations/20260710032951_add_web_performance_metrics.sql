create table if not exists public.web_performance_metrics (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  user_id uuid null references auth.users(id) on delete set null,
  route text not null,
  dataset_mode text null check (dataset_mode in ('own', 'competitor')),
  metric_name text not null,
  metric_value double precision not null check (metric_value >= 0),
  metric_unit text not null default 'ms' check (metric_unit in ('ms', 'score')),
  metadata jsonb not null default '{}'::jsonb,
  user_agent_family text null
);

alter table public.web_performance_metrics enable row level security;

revoke all on public.web_performance_metrics from public, anon, authenticated;
grant all on public.web_performance_metrics to service_role;
grant usage, select on sequence public.web_performance_metrics_id_seq to service_role;

create index if not exists web_performance_metrics_route_recorded_idx
  on public.web_performance_metrics (route, recorded_at desc);
create index if not exists web_performance_metrics_name_recorded_idx
  on public.web_performance_metrics (metric_name, recorded_at desc);

comment on table public.web_performance_metrics is
  'Privacy-safe sampled browser and route performance telemetry. Backend-only Data API access.';
