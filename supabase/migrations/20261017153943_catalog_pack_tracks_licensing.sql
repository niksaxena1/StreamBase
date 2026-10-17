-- Applied live as version 20261017153943.
-- Licensing deliveries per track (Uniqode, Evenfall, ...): which batch a track went in and whether it
-- was only staged (prepared) or actually sent. Status is per track because some prepared tracks are
-- never sent. pack_items stays file-level (Dropbox copies); this table is the track-level record.
alter table catalog.packs
  add column if not exists licensee text,
  add column if not exists batch_date date;

create table if not exists catalog.pack_tracks (
  pack_id bigint not null references catalog.packs(id) on delete cascade,
  catalog_id text not null references catalog.tracks(catalog_id) on delete cascade,
  status text not null default 'staged' check (status in ('staged', 'sent')),
  status_on date not null default current_date,
  dropbox_path text,
  shared_link text,
  primary key (pack_id, catalog_id)
);
create index if not exists pack_tracks_catalog_id_idx on catalog.pack_tracks (catalog_id);

alter table catalog.pack_tracks enable row level security;
revoke all on catalog.pack_tracks from public, anon, authenticated;
grant all on catalog.pack_tracks to service_role;

-- Evenfall 17.10.26 was staged on 2026-10-17; its per-track list was recorded in change_log.
update catalog.packs set licensee = 'Evenfall', batch_date = date '2026-10-17'
 where name = 'Evenfall 17.10.26' and licensee is null;

insert into catalog.pack_tracks (pack_id, catalog_id, status, status_on, dropbox_path, shared_link)
select distinct on (c.target, (c.after->>'pack_id')::bigint) (c.after->>'pack_id')::bigint, c.target, 'staged',
       coalesce((c.after->>'staged_on')::date, c.at::date), c.after->>'dropbox_path', c.after->>'shared_link'
  from catalog.change_log c
  join catalog.tracks t on t.catalog_id = c.target
  join catalog.packs p on p.id = (c.after->>'pack_id')::bigint
 where c.action = 'pack_staged'
 order by c.target, (c.after->>'pack_id')::bigint, c.at desc
on conflict do nothing;

-- Mark tracks staged or sent in one batch; every change is logged.
create or replace function catalog.set_pack_track_status(
  p_pack_id bigint, p_catalog_ids text[], p_status text, p_actor text)
returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if p_status not in ('staged', 'sent') then
    raise exception 'status must be staged or sent';
  end if;
  with changed as (
    update catalog.pack_tracks pt set status = p_status, status_on = current_date
     where pt.pack_id = p_pack_id and pt.catalog_id = any(p_catalog_ids) and pt.status <> p_status
    returning pt.catalog_id
  ), logged as (
    insert into catalog.change_log (actor, action, target, after)
    select p_actor, 'pack_status', c.catalog_id, jsonb_build_object('pack_id', p_pack_id, 'status', p_status)
      from changed c
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $$;
revoke execute on function catalog.set_pack_track_status(bigint, text[], text, text) from public, anon, authenticated;
grant execute on function catalog.set_pack_track_status(bigint, text[], text, text) to service_role;

-- Overview gains one column (appended, so existing readers are unaffected):
-- [{licensee, pack, batch_date, status, status_on}] newest batch first.
create or replace view catalog.track_overview as
 SELECT catalog_id,
    entity,
    release_date,
    sheet_artist,
    sheet_title,
    title,
    artists,
    distributor_account,
    status,
    ( SELECT i.isrc
           FROM catalog.track_isrcs i
          WHERE ((i.catalog_id = t.catalog_id) AND i.is_primary)
         LIMIT 1) AS isrc,
    ( SELECT u.upc
           FROM catalog.track_upcs u
          WHERE ((u.catalog_id = t.catalog_id) AND u.is_primary)
         LIMIT 1) AS upc,
    ( SELECT f.duration_s
           FROM catalog.files f
          WHERE ((f.catalog_id = t.catalog_id) AND (f.role = 'master'::text))
          ORDER BY f.m_version DESC NULLS LAST
         LIMIT 1) AS master_duration_s,
    has_m_master,
    non_exclusive_samples,
    dropbox_link,
    source_folder,
    label_genre,
    originality,
    exclusivity,
    comment_1,
    comment_2,
    cover_original_artist,
    new_distro,
    genre,
    ( SELECT count(*) AS count
           FROM catalog.files f
          WHERE (f.catalog_id = t.catalog_id)) AS file_count,
    updated_at,
    (EXISTS ( SELECT 1
           FROM catalog.files f
          WHERE ((f.catalog_id = t.catalog_id) AND (f.role = 'contract_signed'::text)))) AS has_signed_contract,
    ( SELECT jsonb_agg(jsonb_build_object('licensee', p.licensee, 'pack', p.name, 'batch_date', p.batch_date,
                                          'status', pt.status, 'status_on', pt.status_on)
                       ORDER BY p.batch_date DESC NULLS LAST, p.id DESC)
           FROM catalog.pack_tracks pt
           JOIN catalog.packs p ON p.id = pt.pack_id
          WHERE pt.catalog_id = t.catalog_id) AS licensing
   FROM catalog.tracks t;
