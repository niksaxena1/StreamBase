-- Playlist Watch collections: named, shared groups of watched playlists (e.g. ads per account).
-- A playlist can be in several collections. Server-side access only (service_role after the app's
-- can_access_playlist_watch gate), like playlists and follower_snapshots.

create table if not exists playlist_watch.collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists collections_name_ci_idx on playlist_watch.collections (lower(btrim(name)));

create table if not exists playlist_watch.collection_playlists (
  collection_id        uuid not null references playlist_watch.collections(id) on delete cascade,
  spotify_playlist_id  text not null references playlist_watch.playlists(spotify_playlist_id) on delete cascade,
  added_at             timestamptz not null default now(),
  primary key (collection_id, spotify_playlist_id)
);
create index if not exists collection_playlists_playlist_idx on playlist_watch.collection_playlists (spotify_playlist_id);

alter table playlist_watch.collections enable row level security;
alter table playlist_watch.collection_playlists enable row level security;

create policy "service_role manages playlist watch collections" on playlist_watch.collections
  for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "service_role manages playlist watch collection playlists" on playlist_watch.collection_playlists
  for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

grant all on playlist_watch.collections to service_role;
grant all on playlist_watch.collection_playlists to service_role;
