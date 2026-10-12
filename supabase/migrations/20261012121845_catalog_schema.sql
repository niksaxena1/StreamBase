-- Label catalog (moved from the separate Catalogger project on 2026-10-12).
-- Every release across entities, its drive files and codes; edited from the admin-only
-- /library page through catalog.update_track / catalog.create_track, which write
-- catalog.change_log. Reachable through the Data API by service_role only.
-- Combines Catalogger migrations 20261011203443_catalog_init and
-- 20261012034555_catalog_all_entities_and_edits.

create schema if not exists catalog;
revoke all on schema catalog from public, anon, authenticated;

create table catalog.entities (
  code text primary key check (code ~ '^[a-z]+$'),
  name text not null,
  active boolean not null default false,
  catalog_id_prefix text not null unique
);

-- Every value of the sheet's "Distributor" column. legacy = being migrated, not an entity yet.
create table catalog.distributor_accounts (
  name text primary key,
  owner text not null check (owner in ('tg', 'p', 'n', 'legacy'))
);

create table catalog.tracks (
  catalog_id text primary key check (catalog_id ~ '^[A-Z]+-[0-9]{5}$'),
  entity text not null references catalog.entities(code),
  title text not null,
  artists text[] not null default '{}',
  featured text[] not null default '{}',
  sheet_artist text,
  sheet_title text,
  release_date date,
  distributor_account text references catalog.distributor_accounts(name),
  status text,
  label_genre text,
  originality text,
  exclusivity text,
  non_exclusive_samples boolean not null default false,  -- Splice certificate present
  source_folder text not null,                             -- path on the Y: drive
  dropbox_folder text,
  dropbox_folder_id text,
  dropbox_link text,
  has_m_master boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tracks_entity_idx on catalog.tracks (entity);
create index tracks_release_date_idx on catalog.tracks (release_date);

create table catalog.track_isrcs (
  catalog_id text not null references catalog.tracks(catalog_id) on delete cascade,
  isrc text not null check (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  is_primary boolean not null default true,
  source text not null,
  primary key (catalog_id, isrc)
);
create index track_isrcs_isrc_idx on catalog.track_isrcs (isrc);

create table catalog.track_upcs (
  catalog_id text not null references catalog.tracks(catalog_id) on delete cascade,
  upc text not null check (upc ~ '^[0-9]{12,13}$'),
  is_primary boolean not null default true,
  source text not null,
  primary key (catalog_id, upc)
);
create index track_upcs_upc_idx on catalog.track_upcs (upc);

-- One row per file in the track folder on the drive (Old/ excluded), with what we know about it.
create table catalog.files (
  id bigint generated always as identity primary key,
  catalog_id text not null references catalog.tracks(catalog_id) on delete cascade,
  rel_path text not null,
  role text not null,           -- master, extended, radio_edit, alt_version, final_artwork, artwork_source,
                                -- contract_signed, contract_plain, contract_text_source, splice_certificate,
                                -- cover_license, stem, video, image_other, other_root_audio, other
  m_version integer[],          -- {2} or {1,10} when the name has an M-number (array sorts correctly)
  bytes bigint not null,
  duration_s numeric(10, 3),
  sample_rate integer,
  bit_depth integer,
  channels integer,
  width integer,
  height integer,
  dropbox_path text,
  dropbox_id text,
  content_hash text,            -- Dropbox content hash, set once uploaded and verified
  uploaded_at timestamptz,
  unique (catalog_id, rel_path)
);
create index files_role_idx on catalog.files (role);

create table catalog.contract_texts (
  file_id bigint primary key references catalog.files(id) on delete cascade,
  text text not null,
  method text not null,         -- docx, pdf_text, ocr, ai
  extracted jsonb,
  extracted_at timestamptz not null default now()
);

create table catalog.audit_findings (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  catalog_id text references catalog.tracks(catalog_id) on delete cascade,
  rule text not null,
  detail jsonb,
  resolved boolean not null default false
);
create index audit_findings_open_idx on catalog.audit_findings (rule) where not resolved;

create table catalog.packs (
  id bigint generated always as identity primary key,
  name text not null unique,
  dropbox_path text not null,
  shared_link text,
  note text,
  created_at timestamptz not null default now()
);

create table catalog.pack_items (
  pack_id bigint not null references catalog.packs(id) on delete cascade,
  file_id bigint not null references catalog.files(id) on delete cascade,
  dropbox_path text,
  shared_link text,
  primary key (pack_id, file_id)
);

create table catalog.change_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text not null,
  before jsonb,
  after jsonb
);

-- Convenience view for queries like "tracks over 3 minutes released in 2026".
create view catalog.track_overview with (security_invoker = true) as
select t.catalog_id, t.entity, t.release_date, t.sheet_artist, t.sheet_title, t.title, t.artists,
       t.distributor_account, t.status,
       (select i.isrc from catalog.track_isrcs i where i.catalog_id = t.catalog_id and i.is_primary limit 1) as isrc,
       (select u.upc from catalog.track_upcs u where u.catalog_id = t.catalog_id and u.is_primary limit 1) as upc,
       (select f.duration_s from catalog.files f where f.catalog_id = t.catalog_id and f.role = 'master'
         order by f.m_version desc nulls last limit 1) as master_duration_s,
       t.has_m_master, t.non_exclusive_samples, t.dropbox_link, t.source_folder
from catalog.tracks t;

-- RLS on as defense in depth; no policies, so only service_role / owner connections can read or write.
alter table catalog.entities enable row level security;
alter table catalog.distributor_accounts enable row level security;
alter table catalog.tracks enable row level security;
alter table catalog.track_isrcs enable row level security;
alter table catalog.track_upcs enable row level security;
alter table catalog.files enable row level security;
alter table catalog.contract_texts enable row level security;
alter table catalog.audit_findings enable row level security;
alter table catalog.packs enable row level security;
alter table catalog.pack_items enable row level security;
alter table catalog.change_log enable row level security;

revoke all on all tables in schema catalog from public, anon, authenticated;

insert into catalog.entities (code, name, active, catalog_id_prefix) values
  ('tg', 'TG', true, 'TG'),
  ('p', 'P', false, 'P'),
  ('n', 'N (future)', false, 'N');

-- Catalogger: hold every release (all entities, with or without a drive folder) and make the
-- database the editable source of truth. Edits go through catalog.update_track / create_track,
-- which write catalog.change_log in the same transaction.

insert into catalog.entities (code, name, active, catalog_id_prefix) values
  ('legacy', 'Legacy', false, 'L'),
  ('unassigned', 'Unassigned', false, 'U')
on conflict (code) do nothing;

alter table catalog.tracks alter column source_folder drop not null;
alter table catalog.tracks
  add column comment_1 text,
  add column comment_2 text,
  add column cover_original_artist text,
  add column new_distro text,
  add column genre text,
  add column imported_sheet_row integer;

create table catalog.id_counters (
  prefix text primary key,
  next_value integer not null check (next_value > 0)
);
alter table catalog.id_counters enable row level security;
insert into catalog.id_counters (prefix, next_value) values
  ('TG', 602), ('P', 1), ('N', 1), ('L', 1), ('U', 1);

create function catalog.next_catalog_id(p_prefix text) returns text
language plpgsql set search_path = '' as $$
declare v integer;
begin
  update catalog.id_counters set next_value = next_value + 1
   where prefix = p_prefix returning next_value - 1 into v;
  if v is null then raise exception 'unknown catalog id prefix %', p_prefix; end if;
  return p_prefix || '-' || lpad(v::text, 5, '0');
end $$;

create function catalog.editable_track_columns() returns text[]
language sql immutable set search_path = '' as $$
  select array['entity','title','sheet_artist','sheet_title','release_date','distributor_account',
               'status','label_genre','originality','exclusivity','comment_1','comment_2',
               'cover_original_artist','new_distro','genre','non_exclusive_samples']
$$;

create function catalog.update_track(p_catalog_id text, p_changes jsonb, p_actor text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  k text; before_row jsonb; after_row jsonb; old_code text; new_code text;
  diff_before jsonb := '{}'; diff_after jsonb := '{}';
begin
  if p_actor is null or btrim(p_actor) = '' then raise exception 'actor is required'; end if;
  select to_jsonb(t) into before_row from catalog.tracks t where catalog_id = p_catalog_id for update;
  if before_row is null then raise exception 'track % not found', p_catalog_id; end if;

  for k in select jsonb_object_keys(p_changes) loop
    if k in ('isrc', 'upc') then continue; end if;
    if not (k = any (catalog.editable_track_columns())) then
      raise exception 'column % is not editable', k;
    end if;
    if p_changes -> k is distinct from before_row -> k then
      execute format(
        'update catalog.tracks set %I = (jsonb_populate_record(null::catalog.tracks, $1)).%I where catalog_id = $2',
        k, k) using jsonb_build_object(k, p_changes -> k), p_catalog_id;
      diff_before := diff_before || jsonb_build_object(k, before_row -> k);
      diff_after := diff_after || jsonb_build_object(k, p_changes -> k);
    end if;
  end loop;

  if p_changes ? 'isrc' then
    select isrc into old_code from catalog.track_isrcs where catalog_id = p_catalog_id and is_primary;
    new_code := nullif(upper(regexp_replace(coalesce(p_changes ->> 'isrc', ''), '[^A-Za-z0-9]', '', 'g')), '');
    if new_code is distinct from old_code then
      delete from catalog.track_isrcs where catalog_id = p_catalog_id and is_primary;
      if new_code is not null then
        insert into catalog.track_isrcs (catalog_id, isrc, is_primary, source)
        values (p_catalog_id, new_code, true, 'edit')
        on conflict (catalog_id, isrc) do update set is_primary = true, source = 'edit';
      end if;
      diff_before := diff_before || jsonb_build_object('isrc', old_code);
      diff_after := diff_after || jsonb_build_object('isrc', new_code);
    end if;
  end if;

  if p_changes ? 'upc' then
    select upc into old_code from catalog.track_upcs where catalog_id = p_catalog_id and is_primary;
    new_code := nullif(regexp_replace(coalesce(p_changes ->> 'upc', ''), '[^0-9]', '', 'g'), '');
    if new_code is distinct from old_code then
      delete from catalog.track_upcs where catalog_id = p_catalog_id and is_primary;
      if new_code is not null then
        insert into catalog.track_upcs (catalog_id, upc, is_primary, source)
        values (p_catalog_id, new_code, true, 'edit')
        on conflict (catalog_id, upc) do update set is_primary = true, source = 'edit';
      end if;
      diff_before := diff_before || jsonb_build_object('upc', old_code);
      diff_after := diff_after || jsonb_build_object('upc', new_code);
    end if;
  end if;

  if diff_after <> '{}'::jsonb then
    update catalog.tracks set updated_at = now() where catalog_id = p_catalog_id;
    insert into catalog.change_log (actor, action, target, before, after)
    values (p_actor, 'update_track', p_catalog_id, diff_before, diff_after);
  end if;
  return diff_after;
end $$;

create function catalog.create_track(p_entity text, p_fields jsonb, p_actor text)
returns text language plpgsql set search_path = '' as $$
declare prefix text; new_id text; title text;
begin
  if p_actor is null or btrim(p_actor) = '' then raise exception 'actor is required'; end if;
  select catalog_id_prefix into prefix from catalog.entities where code = p_entity;
  if prefix is null then raise exception 'unknown entity %', p_entity; end if;
  title := nullif(btrim(coalesce(p_fields ->> 'sheet_title', p_fields ->> 'title', '')), '');
  if title is null then raise exception 'title is required'; end if;
  new_id := catalog.next_catalog_id(prefix);
  insert into catalog.tracks (catalog_id, entity, title, sheet_title, sheet_artist, artists)
  values (new_id, p_entity, title, title, p_fields ->> 'sheet_artist',
          coalesce(array(select btrim(a) from unnest(string_to_array(p_fields ->> 'sheet_artist', ',')) a
                         where btrim(a) <> ''), '{}'));
  insert into catalog.change_log (actor, action, target, after)
  values (p_actor, 'create_track', new_id, p_fields);
  perform catalog.update_track(new_id, p_fields - 'title' - 'sheet_title' - 'sheet_artist', p_actor);
  return new_id;
end $$;

grant usage on schema catalog to service_role;
grant select, insert, update, delete on all tables in schema catalog to service_role;
grant usage, select on all sequences in schema catalog to service_role;
alter default privileges in schema catalog grant select, insert, update, delete on tables to service_role;
alter default privileges in schema catalog grant usage, select on sequences to service_role;

revoke execute on all functions in schema catalog from public, anon, authenticated;
grant execute on function catalog.next_catalog_id(text) to service_role;
grant execute on function catalog.editable_track_columns() to service_role;
grant execute on function catalog.update_track(text, jsonb, text) to service_role;
grant execute on function catalog.create_track(text, jsonb, text) to service_role;
alter default privileges in schema catalog revoke execute on functions from public;

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
       t.updated_at
from catalog.tracks t;
grant select on catalog.track_overview to service_role;

-- Expose the schema to PostgREST (service_role only has grants; anon/authenticated have none).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, competitor, playlist_watch, catalog';
notify pgrst, 'reload config';
