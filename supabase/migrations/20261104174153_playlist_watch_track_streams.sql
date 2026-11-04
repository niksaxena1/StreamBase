-- Playlist Watch: track stream tracking for selected playlists (first: "upload", owner request 2026-11-04).
-- Separate from the follower watchlist and from all own-catalog/competitor stream tables.
-- Membership is synced daily from the Spotify Web API; play counts come from Spotify's web-player
-- (the number shown in the Spotify app). Removed tracks keep being collected for
-- removed_retention_days and are shown apart on /playlist-watch/upload.
-- Service-role only; the web app gates with requirePlaylistWatchAccess / can_access_playlist_watch.

create table if not exists playlist_watch.track_watch_playlists (
  spotify_playlist_id text primary key check (spotify_playlist_id ~ '^[A-Za-z0-9]{16,32}$'),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  display_name text,
  owner_display_name text,
  image_url text,
  is_active boolean not null default true,
  removed_retention_days integer not null default 30 check (removed_retention_days between 0 and 365),
  track_count integer,
  latest_checked_at timestamptz,
  last_check_status text,
  last_check_message text,
  created_at timestamptz not null default now()
);

create table if not exists playlist_watch.track_watch_tracks (
  spotify_track_id text primary key check (spotify_track_id ~ '^[A-Za-z0-9]{16,32}$'),
  isrc text,
  name text,
  artists text,
  album_name text,
  image_url text,
  release_date text,
  latest_playcount bigint,
  latest_snapshot_date date,
  last_check_status text,
  updated_at timestamptz not null default now()
);

create table if not exists playlist_watch.track_watch_memberships (
  spotify_playlist_id text not null references playlist_watch.track_watch_playlists(spotify_playlist_id) on delete cascade,
  spotify_track_id text not null references playlist_watch.track_watch_tracks(spotify_track_id) on delete cascade,
  added_at timestamptz,            -- Spotify's added_at (latest add if re-added)
  first_seen_date date not null,   -- first collector run that saw it in the playlist
  last_seen_date date not null,
  removed_date date,               -- first run it was missing; null while in the playlist
  position integer,
  primary key (spotify_playlist_id, spotify_track_id)
);

create index if not exists track_watch_memberships_track_idx
  on playlist_watch.track_watch_memberships (spotify_track_id);

create table if not exists playlist_watch.track_watch_stream_snapshots (
  date date not null,
  spotify_track_id text not null references playlist_watch.track_watch_tracks(spotify_track_id) on delete cascade,
  playcount bigint not null check (playcount >= 0),
  source text not null default 'spotify_web_player',
  captured_at timestamptz not null default now(),
  primary key (spotify_track_id, date)
);

alter table playlist_watch.track_watch_playlists enable row level security;
alter table playlist_watch.track_watch_tracks enable row level security;
alter table playlist_watch.track_watch_memberships enable row level security;
alter table playlist_watch.track_watch_stream_snapshots enable row level security;

revoke all on playlist_watch.track_watch_playlists, playlist_watch.track_watch_tracks,
  playlist_watch.track_watch_memberships, playlist_watch.track_watch_stream_snapshots
  from anon, authenticated;
grant all on playlist_watch.track_watch_playlists, playlist_watch.track_watch_tracks,
  playlist_watch.track_watch_memberships, playlist_watch.track_watch_stream_snapshots
  to service_role;

-- One row per membership with growth windows. Baseline for an N-day window is the latest snapshot
-- on or before (latest snapshot date - N); "since added" is the first snapshot on/after first_seen_date.
create or replace function playlist_watch.track_watch_rows(p_slug text)
returns table (
  spotify_track_id text,
  isrc text,
  name text,
  artists text,
  album_name text,
  image_url text,
  release_date text,
  added_at timestamptz,
  first_seen_date date,
  removed_date date,
  "position" integer,
  latest_date date,
  latest_playcount bigint,
  playcount_1d bigint,
  playcount_7d bigint,
  playcount_28d bigint,
  playcount_at_add bigint,
  date_at_add date,
  history jsonb
)
language sql
stable
security definer
set search_path = playlist_watch, pg_temp
as $$
  with pl as (
    select spotify_playlist_id from playlist_watch.track_watch_playlists where slug = p_slug
  ),
  m as (
    select mm.* from playlist_watch.track_watch_memberships mm join pl using (spotify_playlist_id)
  ),
  latest as (
    select distinct on (s.spotify_track_id) s.spotify_track_id, s.date, s.playcount
    from playlist_watch.track_watch_stream_snapshots s
    where s.spotify_track_id in (select spotify_track_id from m)
    order by s.spotify_track_id, s.date desc
  )
  select
    m.spotify_track_id, t.isrc, t.name, t.artists, t.album_name, t.image_url, t.release_date,
    m.added_at, m.first_seen_date, m.removed_date, m.position,
    l.date, l.playcount,
    (select s.playcount from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = m.spotify_track_id and s.date <= l.date - 1 order by s.date desc limit 1),
    (select s.playcount from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = m.spotify_track_id and s.date <= l.date - 7 order by s.date desc limit 1),
    (select s.playcount from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = m.spotify_track_id and s.date <= l.date - 28 order by s.date desc limit 1),
    a.playcount, a.date,
    coalesce((
      select jsonb_agg(jsonb_build_array(s.date, s.playcount) order by s.date)
      from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = m.spotify_track_id and s.date > l.date - 60
    ), '[]'::jsonb)
  from m
  join playlist_watch.track_watch_tracks t using (spotify_track_id)
  left join latest l using (spotify_track_id)
  left join lateral (
    select s.playcount, s.date from playlist_watch.track_watch_stream_snapshots s
    where s.spotify_track_id = m.spotify_track_id and s.date >= m.first_seen_date
    order by s.date asc limit 1
  ) a on true;
$$;

revoke all on function playlist_watch.track_watch_rows(text) from public, anon, authenticated;
grant execute on function playlist_watch.track_watch_rows(text) to service_role;

insert into playlist_watch.track_watch_playlists (spotify_playlist_id, slug, display_name)
values ('39VN40Aa1bTQEtkuo0HOjD', 'upload', 'upload')
on conflict (spotify_playlist_id) do nothing;

-- Daily at 14:20 UTC (18:20 Abu Dhabi), after the follower snapshot.
select cron.schedule('streambase-playlist-watch-tracks', '20 14 * * *',
  $$select ops.dispatch_workflow('playlist_watch_track_streams_daily.yml')$$);
