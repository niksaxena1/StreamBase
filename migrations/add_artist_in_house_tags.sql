-- Artist in-house tagging.
-- Absence from this table means "NIH" (Non In-House).

create table if not exists public.artist_in_house_tags (
  artist_id text primary key,
  artist_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists artist_in_house_tags_artist_name_idx
  on public.artist_in_house_tags (artist_name);

alter table public.artist_in_house_tags enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'artist_in_house_tags'
      and policyname = 'artist_in_house_tags_read_authenticated'
  ) then
    create policy artist_in_house_tags_read_authenticated
      on public.artist_in_house_tags
      for select
      to authenticated
      using (true);
  end if;
end $$;

create or replace function public.set_artist_in_house_tags_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists artist_in_house_tags_updated_at on public.artist_in_house_tags;

create trigger artist_in_house_tags_updated_at
before update on public.artist_in_house_tags
for each row
execute function public.set_artist_in_house_tags_updated_at();
