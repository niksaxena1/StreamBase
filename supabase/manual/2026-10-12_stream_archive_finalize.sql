-- R2 archive tier: FINALIZE step (OWNER PASTE - contains DELETE, which the agent connector refuses).
-- Run once in the Supabase SQL editor. Nothing is due for archiving until about Sep 2027, so there is no hurry, but
-- the monthly workflow (.github/workflows/stream_archive.yml) raises an alert if a month is archived and this
-- function is missing (the month then simply stays in compact; nothing is lost).
--
-- ops.archive_finalize_month(p_universe, p_month): called by the workflow after the month was exported to R2 and
-- attached + verified (ops.archive_attach_month). In ONE transaction it
--   1. refuses unless the month is registered as attached and is the OLDEST compact month (compact rows must leave
--      oldest-first: stream_compact_from() is the minimum compact month, and the archive tier serves dates before it);
--   2. re-verifies the R2 copy against the DB (streams: counts + EXCEPT ALL both ways; overrides: every archived row
--      exists identically in the DB and the "has base row" flags are right). DB overrides that were added after the
--      export are allowed (they are left in place and keep winning over archived ones);
--   3. removes only the DB override rows that are identical to archived rows (matched by id and every column);
--   4. removes the month's compact row set;
--   5. stamps ops.stream_archive_months.finalized_at.
-- From that moment the month is read from R2 through the same views (track_daily_streams_all / *_effective /
-- *_effective_public); outputs are unchanged.
--
-- Pre-check (read-only): select * from ops.stream_archive_months;   -- attached months and their finalized_at

create or replace function ops.archive_finalize_month(p_universe text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ops, public, competitor, pg_temp
set statement_timeout = '280s'
as $f$
declare
  v_schema text := case when p_universe = 'own' then 'public' else 'competitor' end;
  v_oldest date;
  v_res jsonb;
  v_ov_removed bigint;
  v_compact_removed bigint;
begin
  if p_universe not in ('own', 'competitor') then
    raise exception 'unknown universe %', p_universe;
  end if;
  if not exists (select 1 from ops.stream_archive_months where universe = p_universe and month = p_month) then
    raise exception 'month % of % is not attached (run the archive workflow first)', p_month, p_universe;
  end if;
  if exists (select 1 from ops.stream_archive_months where universe = p_universe and month = p_month and finalized_at is not null) then
    return jsonb_build_object('ok', true, 'note', 'already finalized');
  end if;
  execute format('select min(month) from %I.track_streams_monthly', v_schema) into v_oldest;
  if v_oldest is distinct from p_month then
    raise exception 'only the oldest compact month can be finalized: % is not the oldest (%)', p_month, v_oldest;
  end if;

  v_res := ops.archive_verify_month(p_universe, p_month, 'stream_archive');
  if not ((v_res ->> 'streams_only_in_file')::bigint = 0 and (v_res ->> 'streams_only_in_db')::bigint = 0
          and (v_res ->> 'streams_file_rows')::bigint = (v_res ->> 'streams_db_rows')::bigint
          and (v_res ->> 'streams_file_rows')::bigint > 0
          and (v_res ->> 'overrides_only_in_file')::bigint = 0
          and (v_res ->> 'unknown_kind_rows')::bigint = 0) then
    raise exception 'finalize verification failed: %', v_res::text;
  end if;

  execute format(
    'delete from %1$I.track_daily_stream_overrides o
       using stream_archive.%2$I a
      where a.kind = ''o''
        and o.id = a.oid::bigint
        and o.date = ops.iso_date(a.d)
        and o.isrc = a.isrc
        and o.streams_cumulative_override = a.v::bigint
        and o.note is not distinct from nullif(a.note, ''\N'')
        and o.created_by is not distinct from nullif(a.created_by, ''\N'')::uuid
        and o.created_at = a.created_at::timestamptz',
    v_schema, p_universe || '_rows_' || to_char(p_month, 'YYYYMM'));
  get diagnostics v_ov_removed = row_count;

  execute format('delete from %I.track_streams_monthly where month = $1', v_schema) using p_month;
  get diagnostics v_compact_removed = row_count;

  update ops.stream_archive_months set finalized_at = now() where universe = p_universe and month = p_month;

  return jsonb_build_object('ok', true, 'universe', p_universe, 'month', p_month,
    'compact_rows_removed', v_compact_removed, 'db_override_rows_removed', v_ov_removed, 'verify', v_res);
end
$f$;
revoke all on function ops.archive_finalize_month(text, date) from public, anon, authenticated;

-- Post-check (read-only): the function exists and nothing is finalized yet.
select p.oid::regprocedure as finalize_function,
       (select count(*) from ops.stream_archive_months where finalized_at is not null) as finalized_months
from pg_proc p where p.oid = 'ops.archive_finalize_month(text,date)'::regprocedure;
