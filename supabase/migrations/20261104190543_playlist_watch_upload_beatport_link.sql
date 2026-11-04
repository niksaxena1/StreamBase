-- Playlist Watch upload x Beatport charts (owner request 2026-11-04): Beatport position column for upload
-- tracks, and "upload candidates" = chart tracks not in the upload playlist with their Spotify play counts.
-- Reads charts.* by ISRC only; nothing is copied into charts and charts never feeds public/competitor.
-- Chart tracks' play counts live in the same playlist_watch.track_watch_tracks / _stream_snapshots tables
-- (snapshots are per track, not per playlist), collected by scripts/collect_playlist_watch_track_streams.py.

create table if not exists playlist_watch.track_watch_isrc_map (
  isrc text primary key,
  spotify_track_id text,              -- null when Spotify search found nothing
  checked_at timestamptz not null default now(),
  status text not null default 'ok'   -- ok | name_match (same song, other ISRC) | not_found | error
);
alter table playlist_watch.track_watch_isrc_map enable row level security;
revoke all on playlist_watch.track_watch_isrc_map from anon, authenticated;
grant all on playlist_watch.track_watch_isrc_map to service_role;

-- Beatport history (last 60 days, all active charts) for current and removed upload tracks.
create or replace function playlist_watch.track_watch_chart_positions(p_slug text)
returns table (
  spotify_track_id text,
  chart_key text,
  chart_name text,
  latest_chart_date date,
  "position" integer,          -- on the latest snapshot of that chart; null = not on it today
  position_ref_friday integer, -- on the latest snapshot on or before the reference Friday
  ref_friday date,
  best_position integer,
  days_on_chart integer,
  first_chart_date date
)
language sql
stable
security definer
set search_path = playlist_watch, charts, pg_temp
as $$
  with pl as (select spotify_playlist_id from playlist_watch.track_watch_playlists where slug = p_slug),
  up as (
    select m.spotify_track_id, upper(t.isrc) isrc
    from playlist_watch.track_watch_memberships m join pl using (spotify_playlist_id)
    join playlist_watch.track_watch_tracks t using (spotify_track_id)
    where t.isrc is not null
  ),
  latest as (
    select s.chart_key, max(s.snapshot_date) d from charts.snapshots s
    join charts.charts c using (chart_key) where c.is_active group by s.chart_key
  ),
  ref as (
    -- most recent Friday strictly before each chart's latest snapshot
    select chart_key, d, (d - ((extract(isodow from d)::int - 5 + 7) % 7 + case when extract(isodow from d)::int = 5 then 7 else 0 end))::date fri
    from latest
  ),
  hist as (
    select up.spotify_track_id, e.chart_key, e.snapshot_date, e.position
    from charts.entries e
    join charts.tracks ct on ct.source = e.source and ct.source_track_id = e.source_track_id
    join up on up.isrc = upper(ct.isrc)
    join ref on ref.chart_key = e.chart_key
    where e.snapshot_date > ref.d - 60
  )
  select h.spotify_track_id, h.chart_key, c.display_name, r.d,
    max(h.position) filter (where h.snapshot_date = r.d),
    (array_agg(h.position order by h.snapshot_date desc) filter (where h.snapshot_date <= r.fri))[1],
    r.fri,
    min(h.position), count(distinct h.snapshot_date)::int, min(h.snapshot_date)
  from hist h join ref r using (chart_key) join charts.charts c using (chart_key)
  group by h.spotify_track_id, h.chart_key, c.display_name, r.d, r.fri;
$$;

-- Tracks on the latest snapshot of active charts that are NOT currently in the upload playlist.
create or replace function playlist_watch.track_watch_chart_candidates(p_slug text)
returns table (
  chart_key text,
  chart_name text,
  chart_date date,
  "position" integer,
  position_ref_friday integer,
  ref_friday date,
  best_position integer,
  days_on_chart integer,
  isrc text,
  name text,
  mix_name text,
  artists text,
  label_name text,
  release_date date,
  bpm integer,
  camelot text,
  image_url text,
  beatport_url text,
  spotify_track_id text,
  removed_from_upload_date date,
  latest_date date,
  latest_playcount bigint,
  playcount_1d bigint,
  playcount_7d bigint,
  history jsonb
)
language sql
stable
security definer
set search_path = playlist_watch, charts, pg_temp
as $$
  with pl as (select spotify_playlist_id from playlist_watch.track_watch_playlists where slug = p_slug),
  current_isrcs as (
    select upper(t.isrc) isrc from playlist_watch.track_watch_memberships m join pl using (spotify_playlist_id)
    join playlist_watch.track_watch_tracks t using (spotify_track_id)
    where m.removed_date is null and t.isrc is not null
  ),
  latest as (
    select s.chart_key, max(s.snapshot_date) d from charts.snapshots s
    join charts.charts c using (chart_key) where c.is_active group by s.chart_key
  ),
  ref as (
    select chart_key, d, (d - ((extract(isodow from d)::int - 5 + 7) % 7 + case when extract(isodow from d)::int = 5 then 7 else 0 end))::date fri
    from latest
  ),
  cur as (
    select e.chart_key, e.position, e.source, e.source_track_id, r.d, r.fri
    from charts.entries e join ref r on r.chart_key = e.chart_key and e.snapshot_date = r.d
  )
  select cur.chart_key, c.display_name, cur.d, cur.position,
    (select e2.position from charts.entries e2 where e2.chart_key = cur.chart_key and e2.source = cur.source
       and e2.source_track_id = cur.source_track_id and e2.snapshot_date <= cur.fri order by e2.snapshot_date desc limit 1),
    cur.fri,
    (select min(e3.position) from charts.entries e3 where e3.chart_key = cur.chart_key and e3.source = cur.source
       and e3.source_track_id = cur.source_track_id),
    (select count(*)::int from charts.entries e4 where e4.chart_key = cur.chart_key and e4.source = cur.source
       and e4.source_track_id = cur.source_track_id),
    ct.isrc, ct.name, ct.mix_name, array_to_string(ct.artists, ', '), ct.label_name, ct.release_date, ct.bpm, ct.camelot, ct.image_url, ct.track_url,
    mp.spotify_track_id,
    (select m.removed_date from playlist_watch.track_watch_memberships m join pl using (spotify_playlist_id)
       where m.spotify_track_id = mp.spotify_track_id),
    ls.date, ls.playcount,
    (select s.playcount from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = mp.spotify_track_id and s.date <= ls.date - 1 order by s.date desc limit 1),
    (select s.playcount from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = mp.spotify_track_id and s.date <= ls.date - 7 order by s.date desc limit 1),
    coalesce((select jsonb_agg(jsonb_build_array(s.date, s.playcount) order by s.date)
      from playlist_watch.track_watch_stream_snapshots s
      where s.spotify_track_id = mp.spotify_track_id and s.date > ls.date - 60), '[]'::jsonb)
  from cur
  join charts.charts c on c.chart_key = cur.chart_key
  join charts.tracks ct on ct.source = cur.source and ct.source_track_id = cur.source_track_id
  left join playlist_watch.track_watch_isrc_map mp on mp.isrc = upper(ct.isrc)
  left join lateral (
    select s.date, s.playcount from playlist_watch.track_watch_stream_snapshots s
    where s.spotify_track_id = mp.spotify_track_id order by s.date desc limit 1
  ) ls on true
  where ct.isrc is null or upper(ct.isrc) not in (select isrc from current_isrcs);
$$;

revoke all on function playlist_watch.track_watch_chart_positions(text) from public, anon, authenticated;
revoke all on function playlist_watch.track_watch_chart_candidates(text) from public, anon, authenticated;
grant execute on function playlist_watch.track_watch_chart_positions(text) to service_role;
grant execute on function playlist_watch.track_watch_chart_candidates(text) to service_role;
