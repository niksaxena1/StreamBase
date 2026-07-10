alter table public.web_performance_metrics
  rename column value_ms to metric_value;

alter table public.web_performance_metrics
  add column if not exists metric_unit text not null default 'ms'
  check (metric_unit in ('ms', 'score'));
