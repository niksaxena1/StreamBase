-- Actual monthly revenue (editable per collector + month).
-- Used as an overlay marker on the Monthly Est. Revenue chart (e.g. /collectors).

create table if not exists public.collector_monthly_actual_revenue (
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

-- Ensure PostgREST can read for authenticated users (needed even if RLS is off).
grant select on table public.collector_monthly_actual_revenue to authenticated;

alter table public.collector_monthly_actual_revenue enable row level security;

-- Allow authenticated users to read the overlay data (write access remains server/service-role only).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'collector_monthly_actual_revenue'
      and policyname = 'collector_monthly_actual_revenue_read_authenticated'
  ) then
    create policy collector_monthly_actual_revenue_read_authenticated
      on public.collector_monthly_actual_revenue
      for select
      to authenticated
      using (true);
  end if;
end $$;

