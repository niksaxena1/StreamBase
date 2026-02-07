-- Actual monthly revenue (editable per collector + month).
-- Used as an overlay marker on the Monthly Est. Revenue chart (e.g. /collectors).

create table if not exists collector_monthly_actual_revenue (
  collector text not null,
  month text not null,
  amount_usd numeric not null,
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint collector_monthly_actual_revenue_pkey primary key (collector, month),
  constraint collector_monthly_actual_revenue_month_fmt check (month ~ '^\d{4}-\d{2}$'),
  constraint collector_monthly_actual_revenue_amount_nonneg check (amount_usd >= 0)
);

alter table if exists collector_monthly_actual_revenue enable row level security;

