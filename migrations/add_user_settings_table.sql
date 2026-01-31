-- Add user_settings table for storing user preferences
create table if not exists user_settings (
  id bigint primary key generated always as identity,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  sai_enabled boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Enable RLS
alter table user_settings enable row level security;

-- Policy: Users can read/update their own settings
create policy "Users can manage their own settings"
  on user_settings
  for all
  using (auth.uid() = user_id);
