-- Applied live as version 20261012153950; numbered here after 20261012171500_effective_latest_date_helpers,
-- which creates effective_latest_date() used below, so a chronological replay works.
-- Library additions: streams per release (via the primary ISRC), a per-release stream series,
-- a signed-contract flag for the "needs attention" panel, and bulk edits that log per track.

-- Total streams, last-7-day streams and Spotify art for every release with a primary ISRC.
create function catalog.track_streams()
returns table (catalog_id text, isrc text, total_streams bigint, streams_7d bigint, as_of date,
               album_image_url text, spotify_track_id text)
language sql stable set search_path = '' as $$
  with d as (select public.effective_latest_date() as l),
  cur as (select * from public.effective_streams_for_date((select l from d))),
  prev as (select * from public.effective_streams_for_date((select l from d) - 7))
  select i.catalog_id, i.isrc, cur.streams_cumulative,
         greatest(cur.streams_cumulative - coalesce(prev.streams_cumulative, 0), 0),
         (select l from d), t.spotify_album_image_url, t.spotify_track_id
  from catalog.track_isrcs i
  join cur on cur.isrc = i.isrc
  left join prev on prev.isrc = i.isrc
  left join public.tracks t on t.isrc = i.isrc
  where i.is_primary
$$;

-- Daily cumulative streams for one release over the last p_days days (for the detail chart).
create function catalog.track_stream_series(p_catalog_id text, p_days integer default 90)
returns table (date date, streams_cumulative bigint)
language sql stable set search_path = '' as $$
  select s.date, s.streams_cumulative
  from catalog.track_isrcs i,
       public.track_daily_streams_range_isrcs(public.effective_latest_date() - least(greatest(p_days, 7), 730),
                                              public.effective_latest_date(), array[i.isrc]) s
  where i.catalog_id = p_catalog_id and i.is_primary
  order by s.date
$$;

-- Applies the same changes to many releases; each track gets its own change_log entry.
create function catalog.bulk_update_tracks(p_catalog_ids text[], p_changes jsonb, p_actor text)
returns integer language plpgsql set search_path = '' as $$
declare cid text; changed integer := 0;
begin
  if coalesce(array_length(p_catalog_ids, 1), 0) > 3000 then raise exception 'too many tracks'; end if;
  if p_changes ? 'isrc' or p_changes ? 'upc' then raise exception 'ISRC/UPC cannot be bulk edited'; end if;
  foreach cid in array p_catalog_ids loop
    if catalog.update_track(cid, p_changes, p_actor) <> '{}'::jsonb then changed := changed + 1; end if;
  end loop;
  return changed;
end $$;

-- Overview gains a signed-contract flag (appended so existing columns keep their order).
create or replace view catalog.track_overview with (security_invoker = true) as
select t.catalog_id, t.entity, t.release_date, t.sheet_artist, t.sheet_title, t.title, t.artists,
       t.distributor_account, t.status,
       (select i.isrc from catalog.track_isrcs i where i.catalog_id = t.catalog_id and i.is_primary limit 1) as isrc,
       (select u.upc from catalog.track_upcs u where u.catalog_id = t.catalog_id and u.is_primary limit 1) as upc,
       (select f.duration_s from catalog.files f where f.catalog_id = t.catalog_id and f.role = 'master'
         order by f.m_version desc nulls last limit 1) as master_duration_s,
       t.has_m_master, t.non_exclusive_samples, t.dropbox_link, t.source_folder,
       t.label_genre, t.originality, t.exclusivity, t.comment_1, t.comment_2,
       t.cover_original_artist, t.new_distro, t.genre,
       (select count(*) from catalog.files f where f.catalog_id = t.catalog_id) as file_count,
       t.updated_at,
       exists (select 1 from catalog.files f where f.catalog_id = t.catalog_id and f.role = 'contract_signed') as has_signed_contract
from catalog.tracks t;

revoke execute on function catalog.track_streams() from public, anon, authenticated;
revoke execute on function catalog.track_stream_series(text, integer) from public, anon, authenticated;
revoke execute on function catalog.bulk_update_tracks(text[], jsonb, text) from public, anon, authenticated;
grant execute on function catalog.track_streams() to service_role;
grant execute on function catalog.track_stream_series(text, integer) to service_role;
grant execute on function catalog.bulk_update_tracks(text[], jsonb, text) to service_role;
grant select on catalog.track_overview to service_role;
notify pgrst, 'reload schema';
