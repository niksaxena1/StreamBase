-- Cache Spotify artist image URLs (refreshed monthly-ish).
-- This is used to avoid repeated Spotify API calls from search/catalog pages.

create table if not exists public.spotify_artist_images (
  artist_id text primary key,
  name text,
  image_url text,
  external_url text,
  refreshed_at timestamptz not null default now()
);

create index if not exists spotify_artist_images_refreshed_at_idx
  on public.spotify_artist_images (refreshed_at desc);

-- Enable RLS, but we typically read/write with service role.
alter table public.spotify_artist_images enable row level security;

-- Optional: allow authenticated users to read cached images.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'spotify_artist_images'
      and policyname = 'spotify_artist_images_read_authenticated'
  ) then
    create policy spotify_artist_images_read_authenticated
      on public.spotify_artist_images
      for select
      to authenticated
      using (true);
  end if;
end $$;

