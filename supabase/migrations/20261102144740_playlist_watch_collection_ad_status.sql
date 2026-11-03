-- Playlist Watch: per-membership ad status.
-- A playlist inside a collection (one per ad account) is "live" while an ad currently promotes it
-- and "stopped" once its ads ended; null = no ad status recorded. This replaces the
-- "<name> · Live" / "<name> · Stopped" sibling-collection workaround.
-- Table access stays service_role only (existing RLS + grants cover the new columns).

alter table playlist_watch.collection_playlists
  add column if not exists ad_status text check (ad_status in ('live', 'stopped')),
  add column if not exists ad_status_changed_at timestamptz;

-- Data conversion. No-op when the collections do not exist (fresh databases).
-- Separator is U+00B7 MIDDLE DOT surrounded by spaces, built with chr(183) to stay encoding-safe.
-- 'Stopped' is applied before 'Live' so a playlist found in both ends up live.
do $$
declare
  base_name text;
  base_id uuid;
  suffix text;
  sibling_id uuid;
begin
  foreach base_name in array array['DHH Ads', 'HG Ads'] loop
    select id into base_id from playlist_watch.collections where name = base_name;
    if base_id is null then
      continue;
    end if;

    foreach suffix in array array['Stopped', 'Live'] loop
      select id into sibling_id
      from playlist_watch.collections
      where name = base_name || ' ' || chr(183) || ' ' || suffix;
      if sibling_id is null then
        continue;
      end if;

      -- A Live/Stopped member missing from the base collection joins it.
      insert into playlist_watch.collection_playlists (collection_id, spotify_playlist_id)
      select base_id, s.spotify_playlist_id
      from playlist_watch.collection_playlists s
      where s.collection_id = sibling_id
      on conflict (collection_id, spotify_playlist_id) do nothing;

      update playlist_watch.collection_playlists b
      set ad_status = lower(suffix),
          ad_status_changed_at = now()
      from playlist_watch.collection_playlists s
      where s.collection_id = sibling_id
        and b.collection_id = base_id
        and b.spotify_playlist_id = s.spotify_playlist_id;

      -- Memberships of the sibling cascade away with it.
      delete from playlist_watch.collections where id = sibling_id;
    end loop;
  end loop;
end
$$;
