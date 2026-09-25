-- Saved filters: persist user filter presets across devices
create table if not exists saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  entity_type text not null,
  config jsonb not null,            -- full FilterConfig (groups, conditions, etc.)
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index saved_filters_user_id_idx on saved_filters(user_id);

-- Enable RLS
alter table saved_filters enable row level security;

-- Policy: Users can manage their own saved filters
create policy "Users can manage their own saved filters"
  on saved_filters
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
