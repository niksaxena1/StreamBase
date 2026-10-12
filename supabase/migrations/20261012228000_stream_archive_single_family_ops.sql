-- Phase 3 follow-up: ops functions for the single-file-per-month archive family (see 20261012227000).
-- File: <prefix>/<universe>/archive_<YYYY-MM>.csv.gz, header kind,d,isrc,v,oid,note,created_by,created_at;
-- kind 's' rows = stream rows (v = cumulative streams); kind 'o' rows = override rows
-- (d = date, v = override value, oid/note/created_by/created_at = override metadata). NULL is written as \N.

create or replace function ops.archive_create_foreign_tables(p_universe text, p_month date, p_foreign_schema text, p_selftest boolean)
returns void
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $f$
declare
  v_bucket text := (select value from ops.stream_archive_config where key = 'bucket');
  v_prefix text := (select value from ops.stream_archive_config where key = 'key_prefix');
  v_child text := p_universe || '_rows_' || to_char(p_month, 'YYYYMM');
  v_parent text := p_universe || '_rows';
  v_path text := case when p_selftest then v_prefix || '/_selftest/' || p_universe else v_prefix || '/' || p_universe end;
  v_lo text := quote_literal(to_char(p_month, 'YYYY-MM-DD'));
  v_hi text := quote_literal(to_char((p_month + interval '1 month')::date, 'YYYY-MM-DD'));
begin
  if p_universe not in ('own', 'competitor') then
    raise exception 'unknown universe %', p_universe;
  end if;
  if to_regclass(format('%I.%I', p_foreign_schema, v_child)) is null then
    execute format(
      'create foreign table %I.%I () inherits (%I.%I) server streambase_r2 options (uri %L, format %L, has_header %L, compress %L)',
      p_foreign_schema, v_child, p_foreign_schema, v_parent,
      's3://' || v_bucket || '/' || v_path || '/archive_' || to_char(p_month, 'YYYY-MM') || '.csv.gz', 'csv', 'true', 'gzip');
  elsif not exists (select 1 from pg_inherits i where i.inhrelid = format('%I.%I', p_foreign_schema, v_child)::regclass) then
    execute format('alter foreign table %I.%I inherit %I.%I', p_foreign_schema, v_child, p_foreign_schema, v_parent);
  end if;
  -- the window the planner uses to skip this file for queries outside the month
  if not exists (select 1 from pg_constraint c where c.conrelid = format('%I.%I', p_foreign_schema, v_child)::regclass
                 and c.conname = v_child || '_window') then
    execute format(
      'alter foreign table %I.%I add constraint %I check (ops.iso_date(d) >= date %s and ops.iso_date(d) < date %s)',
      p_foreign_schema, v_child, v_child || '_window', v_lo, v_hi);
  end if;
end
$f$;
revoke all on function ops.archive_create_foreign_tables(text, date, text, boolean) from public, anon, authenticated;

-- Verify a month's file against the DB: stream rows vs the compact month, override rows vs the DB overrides of that
-- month (counts + EXCEPT ALL both ways). The file is read ONCE (materialized CTE; the FDW has no pushdown).
create or replace function ops.archive_verify_month(p_universe text, p_month date, p_foreign_schema text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, pg_temp
set statement_timeout = '280s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_child text := p_universe || '_rows_' || to_char(p_month, 'YYYYMM');
  v_t0 timestamptz := clock_timestamp();
  v_s_file bigint; v_s_db bigint; v_s_a bigint; v_s_b bigint;
  v_o_file bigint; v_o_db bigint; v_o_a bigint; v_o_b bigint; v_bad bigint;
begin
  execute format($q$
    with f as materialized (
           select r.kind as kind, r.d as d, r.isrc as isrc, r.v as v, r.oid as oid, r.note as note,
                  r.created_by as created_by, r.created_at as created_at
           from %1$I.%2$I r),
         fs as materialized (select ops.iso_date(d) as d, isrc, v::bigint as s from f where kind = 's'),
         fo as materialized (select oid::bigint as id, ops.iso_date(d) as d, isrc, v::bigint as v,
                                    nullif(note, '\N') as note, nullif(created_by, '\N')::uuid as cb,
                                    created_at::timestamptz as ca from f where kind = 'o'),
         c as materialized (select (m.month + (u.d - 1)::int) as d, m.isrc as isrc, u.v as s
                            from %3$I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
                            where m.month = $1 and u.v is not null),
         o as materialized (select id, date as d, isrc, streams_cumulative_override as v, note, created_by as cb, created_at as ca
                            from %3$I.track_daily_stream_overrides where date >= $1 and date < ($1 + interval '1 month')::date)
    select (select count(*) from fs), (select count(*) from c),
           (select count(*) from (select d, isrc, s from fs except all select d, isrc, s from c) x),
           (select count(*) from (select d, isrc, s from c except all select d, isrc, s from fs) y),
           (select count(*) from fo), (select count(*) from o),
           (select count(*) from (select id, d, isrc, v, note, cb, ca from fo except all select id, d, isrc, v, note, cb, ca from o) x2),
           (select count(*) from (select id, d, isrc, v, note, cb, ca from o except all select id, d, isrc, v, note, cb, ca from fo) y2),
           (select count(*) from f where kind not in ('s', 'o'))$q$,
    p_foreign_schema, v_child, v_schema)
    into v_s_file, v_s_db, v_s_a, v_s_b, v_o_file, v_o_db, v_o_a, v_o_b, v_bad using p_month;

  return jsonb_build_object(
    'ok', (v_s_file = v_s_db and v_s_file > 0 and v_s_a = 0 and v_s_b = 0
           and v_o_file = v_o_db and v_o_a = 0 and v_o_b = 0 and v_bad = 0),
    'universe', p_universe, 'month', p_month,
    'streams_file_rows', v_s_file, 'streams_db_rows', v_s_db, 'streams_only_in_file', v_s_a, 'streams_only_in_db', v_s_b,
    'overrides_file_rows', v_o_file, 'overrides_db_rows', v_o_db, 'overrides_only_in_file', v_o_a, 'overrides_only_in_db', v_o_b,
    'unknown_kind_rows', v_bad,
    'file_read_and_compare_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
end
$f$;
revoke all on function ops.archive_verify_month(text, date, text) from public, anon, authenticated;
