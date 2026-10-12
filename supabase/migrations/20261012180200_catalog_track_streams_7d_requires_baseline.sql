-- Applied live as version 20261012173643.
-- streams_7d is null (not the lifetime total) when there is no snapshot from 7 days earlier.
create or replace function catalog.track_streams()
returns table (catalog_id text, isrc text, total_streams bigint, streams_7d bigint, as_of date,
               album_image_url text, spotify_track_id text)
language sql stable set search_path = '' as $$
  with d as (select public.effective_latest_date() as l),
  cur as (select * from public.effective_streams_for_date((select l from d))),
  prev as (select * from public.effective_streams_for_date((select l from d) - 7))
  select i.catalog_id, i.isrc, cur.streams_cumulative,
         case when prev.isrc is null then null
              else greatest(cur.streams_cumulative - prev.streams_cumulative, 0) end,
         (select l from d), t.spotify_album_image_url, t.spotify_track_id
  from catalog.track_isrcs i
  join cur on cur.isrc = i.isrc
  left join prev on prev.isrc = i.isrc
  left join public.tracks t on t.isrc = i.isrc
  where i.is_primary
$$;
revoke execute on function catalog.track_streams() from public, anon, authenticated;
grant execute on function catalog.track_streams() to service_role;
