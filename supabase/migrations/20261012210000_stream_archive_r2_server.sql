-- Phase 3 / step 1: Cloudflare R2 archive tier plumbing (Supabase Wrappers S3 foreign data wrapper).
-- The R2 endpoint is built from the vault at apply time (the account id is never written to a file) and the S3
-- credentials are referenced by vault secret id, never by value. Note: the endpoint URL (which contains the account
-- id) is stored in pg_foreign_server.srvoptions, readable by DB admins only.
create extension if not exists wrappers with schema extensions;

do $$
begin
  if not exists (select 1 from pg_foreign_data_wrapper where fdwname = 's3_wrapper') then
    create foreign data wrapper s3_wrapper handler extensions.s3_fdw_handler validator extensions.s3_fdw_validator;
  end if;
end
$$;

create table if not exists ops.stream_archive_config (
  key text primary key,
  value text not null
);
alter table ops.stream_archive_config enable row level security;
revoke all on ops.stream_archive_config from public, anon, authenticated;
grant all on ops.stream_archive_config to service_role;

-- Policy knobs (config, not literals).
insert into ops.stream_archive_config (key, value) values
  ('bucket', 'streambase-archive'),
  ('key_prefix', 'v1'),
  ('packed_months_keep', '12')
on conflict (key) do nothing;

do $$
declare
  v_account text;
  v_key_id uuid;
  v_secret_id uuid;
begin
  if exists (select 1 from pg_foreign_server where srvname = 'streambase_r2') then
    return;
  end if;
  select decrypted_secret into v_account from vault.decrypted_secrets where name = 'r2_account_id';
  select id into v_key_id from vault.secrets where name = 'r2_access_key_id';
  select id into v_secret_id from vault.secrets where name = 'r2_secret_access_key';
  if v_account is null or v_key_id is null or v_secret_id is null then
    raise exception 'R2 vault secrets (r2_account_id, r2_access_key_id, r2_secret_access_key) are missing';
  end if;
  execute format(
    'create server streambase_r2 foreign data wrapper s3_wrapper options (
       vault_access_key_id %L, vault_secret_access_key %L, aws_region %L, endpoint_url %L, path_style_url %L)',
    v_key_id::text, v_secret_id::text, 'auto', 'https://' || trim(v_account) || '.r2.cloudflarestorage.com', 'true');
end
$$;

create schema if not exists archive_stage;
revoke all on schema archive_stage from public, anon, authenticated;
