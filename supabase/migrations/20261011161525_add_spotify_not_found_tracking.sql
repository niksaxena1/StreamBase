-- Keep Spotify search outcomes isolated in each analytics universe.
alter table public.tracks
  add column if not exists spotify_lookup_misses integer not null default 0,
  add column if not exists spotify_not_found_since timestamptz;

alter table competitor.tracks
  add column if not exists spotify_lookup_misses integer not null default 0,
  add column if not exists spotify_not_found_since timestamptz;

comment on column public.tracks.spotify_lookup_misses is
  'Consecutive Spotify ISRC search misses; reset to zero on a match.';
comment on column competitor.tracks.spotify_lookup_misses is
  'Consecutive Spotify ISRC search misses; reset to zero on a match.';
comment on column public.tracks.spotify_not_found_since is
  'First confirmed Spotify ISRC search absence after two misses. Monthly rechecks use spotify_last_fetched_at; cleared on a match.';
comment on column competitor.tracks.spotify_not_found_since is
  'Confirmed Spotify ISRC search absence after two misses. Restarted on monthly misses because this schema has no spotify_last_fetched_at; cleared on a match.';
