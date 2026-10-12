"""Generate the SQL for the R2 archive tier (single template, used for the live objects AND the self-test copy).

    python scripts/gen_stream_archive_sql.py

Writes (committed, applied as migrations):
  supabase/migrations/20261012220000_stream_archive_tier_core.sql
  supabase/migrations/20261012221000_stream_archive_selftest_objects.sql

Why one template: the monthly self-test builds the *same* views over a test copy of the archive files, so what the
self-test proves is the text of the live views. Edit this file, regenerate, never edit the generated SQL by hand.
"""

import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase" / "migrations"

UNIVERSES = [
    # name, schema, derives est_revenue_total (competitor only), uuid type of source_run_id
    {"u": "own", "s": "public", "comp": False, "run_t": "uuid"},
    {"u": "competitor", "s": "competitor", "comp": True, "run_t": "bigint"},
]


def names(U, test: bool):
    """Object names for the live tier or for the self-test copy."""
    s = U["s"]
    if not test:
        return {
            "T": s,                                    # target schema for the generated views
            "daily": f"{s}.track_daily_streams",
            "ovr": f"{s}.track_daily_stream_overrides",
            "compact": f"{s}.track_streams_monthly",
            "arch": f"{s}.track_daily_streams_archive",
            "arch_ovr": f"{s}.track_daily_stream_overrides_archive",
            "compact_from": f"{s}.stream_compact_from()",
            "hot_from": f"{s}.stream_history_hot_from()",
            "ovr_all": f"{s}.track_daily_stream_overrides_all",
            "base_all": f"{s}.track_daily_streams_base_all",
            "eff": f"{s}.track_daily_streams_effective",
        }
    p = f"archive_selftest.{U['u']}_"
    return {
        "T": "archive_selftest",
        "daily": f"{s}.track_daily_streams",
        "ovr": f"{s}.track_daily_stream_overrides",
        "compact": f"archive_selftest.{U['u']}_compact",
        "arch": f"{p}archive",
        "arch_ovr": f"{p}overrides_archive",
        "compact_from": f"archive_selftest.{U['u']}_compact_from()",
        "hot_from": f"{s}.stream_history_hot_from()",
        "ovr_all": f"{p}overrides_all",
        "base_all": f"{p}base_all",
        "eff": f"{p}effective",
    }


def est(U, col):
    return f"{U['s']}.stream_est_revenue({col})" if U["comp"] else None


def views_sql(U, N):
    """overrides_all, base_all, effective (live or self-test names)."""
    s = U["s"]
    run_t = U["run_t"]
    comp = U["comp"]
    est_col_daily = ", t.est_revenue_total" if comp else ""
    est_col_compact = (f", {s}.stream_est_revenue(m.vals[extract(day from c.d)::int]) as est_revenue_total") if comp else ""
    est_col_arch = (f", {s}.stream_est_revenue(a.streams_cumulative) as est_revenue_total") if comp else ""
    out = []
    out.append(f"""create or replace view {N['ovr_all']} as
  select o.id, o.date, o.isrc, o.streams_cumulative_override, o.note, o.created_by, o.created_at,
         case when o.date < {N['compact_from']}
              then ((o.date, o.isrc) not in (select a.date, a.isrc from {N['arch']} a))
         end as base_missing
  from {N['ovr']} o
  union all
  select a.id, a.date, a.isrc, a.streams_cumulative_override, a.note, a.created_by, a.created_at, a.base_missing
  from {N['arch_ovr']} a
  where a.date < {N['compact_from']}
    and not exists (select 1 from {N['ovr']} d where d.date = a.date and d.isrc = a.isrc);
""")
    out.append(f"""create or replace view {N['base_all']} as
  select t.date, t.isrc, t.streams_cumulative{est_col_daily}, t.source_run_id, t.created_at as base_created_at
  from {N['daily']} t
  where t.date >= {N['hot_from']}
  union all
  select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative{est_col_compact},
         null::{run_t} as source_run_id, null::timestamptz as base_created_at
  from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)
        where date '2025-01-01' + g.i < {N['hot_from']}) c
  join {N['compact']} m on m.month = date_trunc('month', c.d)::date
  where m.vals[extract(day from c.d)::int] is not null
  union all
  select a.date, a.isrc, a.streams_cumulative{est_col_arch},
         null::{run_t} as source_run_id, null::timestamptz as base_created_at
  from {N['arch']} a
  where a.date < {N['compact_from']};
""")
    out.append(f"""create or replace view {N['eff']} as
  select t.date,
         t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative,
         t.source_run_id,
         t.base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['base_all']} t
  left join {N['ovr_all']} o on o.date = t.date and o.isrc = t.isrc
  union all
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['ovr_all']} o
  where (o.date >= {N['compact_from']} or o.base_missing)
    and not exists (select 1 from {N['daily']} t
                    where t.date = o.date and t.isrc = o.isrc and t.date >= {N['hot_from']})
    and not exists (select 1 from {N['compact']} m
                    where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                      and m.month < {N['hot_from']}
                      and m.vals[extract(day from o.date)::int] is not null);
""")
    return "\n".join(out)


def eff_split_sql(U, N):
    """Effective view split by tier so the archive-tier join (the only one that can open a foreign scan) is a branch of its own:
    (a) hot + compact base rows joined to DB overrides only, (b) archive base rows joined to DB + archived overrides,
    (c) override-only rows. A recent-range query makes branch (b)'s base side empty, so its override join never reads R2."""
    run_t = U["run_t"]
    cols_out = """         t.source_run_id,
         t.base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by"""
    return f"""create or replace view {N['eff']} as
  select t.date,
         t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative,
{cols_out}
  from (
    select d.date, d.isrc, d.streams_cumulative, d.source_run_id, d.created_at as base_created_at
    from {N['daily']} d
    where d.date >= {N['hot_from']}
    union all
    select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
           null::{run_t} as source_run_id, null::timestamptz as base_created_at
    from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)
          where date '2025-01-01' + g.i < {N['hot_from']}) c
    join {N['compact']} m on m.month = date_trunc('month', c.d)::date
    where m.vals[extract(day from c.d)::int] is not null
  ) t
  left join {N['ovr']} o on o.date = t.date and o.isrc = t.isrc
  union all
  select a.date,
         a.isrc,
         coalesce(o.streams_cumulative_override, a.streams_cumulative) as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['arch']} a
  left join {N['ovr_all']} o on o.date = a.date and o.isrc = a.isrc
  where a.date < {N['compact_from']}
  union all
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['ovr_all']} o
  where (o.date >= {N['compact_from']} or o.base_missing)
    and not exists (select 1 from {N['daily']} t
                    where t.date = o.date and t.isrc = o.isrc and t.date >= {N['hot_from']})
    and not exists (select 1 from {N['compact']} m
                    where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                      and m.month < {N['hot_from']}
                      and m.vals[extract(day from o.date)::int] is not null);
"""


def range_sql(U):
    s = U["s"]
    comp = U["comp"]
    cols = "date date, isrc text, streams_cumulative bigint" + (", est_revenue_total numeric" if comp else "")
    est_a = f", {s}.stream_est_revenue(a.streams_cumulative)" if comp else ""
    est_d = ", t.est_revenue_total" if comp else ""
    est_c = f", {s}.stream_est_revenue(u.v)" if comp else ""
    return f"""create or replace function {s}.track_daily_streams_range(p_start date, p_end date, p_isrcs text[] default null)
returns table ({cols})
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative{est_d}
  from {s}.track_daily_streams t
  where t.date >= p_start
    and t.date >= {s}.stream_history_hot_from()
    and t.date <= p_end
    and (p_isrcs is null or t.isrc = any (p_isrcs))
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v{est_c}
  from {s}.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < {s}.stream_history_hot_from()
    and (p_isrcs is null or m.isrc = any (p_isrcs))
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
  union all
  select a.date, a.isrc, a.streams_cumulative{est_a}
  from {s}.track_daily_streams_archive a
  where a.date >= p_start and a.date <= p_end
    and a.date < {s}.stream_compact_from()
    and (p_isrcs is null or a.isrc = any (p_isrcs))
$$;

create or replace function {s}.track_daily_streams_range_isrcs(p_start date, p_end date, p_isrcs text[])
returns table ({cols})
language sql stable parallel safe
as $$
  select t.date, t.isrc, t.streams_cumulative{est_d}
  from {s}.track_daily_streams t
  where t.isrc = any (p_isrcs)
    and t.date >= p_start
    and t.date >= {s}.stream_history_hot_from()
    and t.date <= p_end
  union all
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v{est_c}
  from {s}.track_streams_monthly m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.isrc = any (p_isrcs)
    and m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < {s}.stream_history_hot_from()
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
  union all
  select a.date, a.isrc, a.streams_cumulative{est_a}
  from {s}.track_daily_streams_archive a
  where a.isrc = any (p_isrcs)
    and a.date >= p_start and a.date <= p_end
    and a.date < {s}.stream_compact_from()
$$;
"""


def core_sql():
    parts = ["""-- GENERATED by scripts/gen_stream_archive_sql.py - do not edit by hand.
-- Phase 3 / R2 archive tier, live objects. Three tiers:
--   archive  dates <  stream_compact_from()         CSV.gz files in R2, read through the S3 foreign data wrapper
--   compact  stream_compact_from() .. hot_from      <schema>.track_streams_monthly
--   daily    dates >= stream_history_hot_from()     partitioned daily table
-- Nothing is archived yet (no month is older than the packed-months policy), so the archive views are empty until
-- the monthly workflow attaches the first month.

create schema if not exists stream_archive;
revoke all on schema stream_archive from public, anon, authenticated;

create table if not exists ops.stream_archive_months (
  universe text not null check (universe in ('own', 'competitor')),
  month date not null,
  streams_rows bigint not null,
  overrides_rows bigint not null,
  attached_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (universe, month)
);
alter table ops.stream_archive_months enable row level security;
revoke all on ops.stream_archive_months from public, anon, authenticated;
grant all on ops.stream_archive_months to service_role;
"""]
    for U in UNIVERSES:
        s = U["s"]
        N = names(U, False)
        parts.append(f"""
-- ---------------------------------------------------------------------------------------------------------
-- {U['u']} ({s})
-- ---------------------------------------------------------------------------------------------------------
-- First day served from the compact tier (everything earlier is served from the R2 archive).
-- SECURITY DEFINER like stream_history_hot_from(): views call it for anon/authenticated readers.
create or replace function {s}.stream_compact_from()
returns date
language sql stable security definer parallel safe
set search_path = {s}, pg_temp
as $$
  select coalesce((select min(m.month) from {s}.track_streams_monthly m), {s}.stream_history_hot_from())
$$;
grant execute on function {s}.stream_compact_from() to anon, authenticated, service_role;

-- Archive views start empty; ops.archive_rebuild_views() regenerates them from ops.stream_archive_months.
do $v$
begin
  if not exists (select 1 from pg_views where schemaname = '{s}' and viewname = 'track_daily_streams_archive') then
    create view {s}.track_daily_streams_archive as
      select null::date as date, null::text as isrc, null::bigint as streams_cumulative where false;
  end if;
  if not exists (select 1 from pg_views where schemaname = '{s}' and viewname = 'track_daily_stream_overrides_archive') then
    create view {s}.track_daily_stream_overrides_archive as
      select null::bigint as id, null::date as date, null::text as isrc, null::bigint as streams_cumulative_override,
             null::text as note, null::uuid as created_by, null::timestamptz as created_at, null::boolean as base_missing
      where false;
  end if;
end
$v$;
revoke all on {s}.track_daily_streams_archive from public, anon, authenticated;
revoke all on {s}.track_daily_stream_overrides_archive from public, anon, authenticated;
grant select on {s}.track_daily_streams_archive, {s}.track_daily_stream_overrides_archive to service_role;

{views_sql(U, N)}
revoke all on {s}.track_daily_stream_overrides_all from public, anon, authenticated;
grant select on {s}.track_daily_stream_overrides_all to service_role;

{range_sql(U)}""")
    return "\n".join(parts)


def selftest_sql():
    parts = ["""-- GENERATED by scripts/gen_stream_archive_sql.py - do not edit by hand.
-- Phase 3 / self-test copy of the archive tier. Same view text as the live objects (same template), but:
--   * <u>_compact is the real compact table WITHOUT the test month (so the test month is served by the archive),
--   * the archive views read a COPY of the test month's files under <prefix>/_selftest/.
-- Nothing here writes to real data.
create schema if not exists archive_selftest;
revoke all on schema archive_selftest from public, anon, authenticated;

create table if not exists archive_selftest.config (
  universe text primary key,
  test_month date not null
);
create table if not exists archive_selftest.months (
  universe text not null,
  month date not null,
  primary key (universe, month)
);
alter table archive_selftest.config enable row level security;
alter table archive_selftest.months enable row level security;
revoke all on archive_selftest.config, archive_selftest.months from public, anon, authenticated;
grant all on archive_selftest.config, archive_selftest.months to service_role;
"""]
    for U in UNIVERSES:
        s = U["s"]
        u = U["u"]
        N = names(U, True)
        parts.append(f"""
-- ---------------------------------------------------------------------------------------------------------
-- {u}
-- ---------------------------------------------------------------------------------------------------------
create or replace view archive_selftest.{u}_compact as
  select m.* from {s}.track_streams_monthly m
  where m.month <> coalesce((select c.test_month from archive_selftest.config c where c.universe = '{u}'), date '0001-01-01');

create or replace function archive_selftest.{u}_compact_from()
returns date
language sql stable security definer
set search_path = archive_selftest, {s}, pg_temp
as $$
  select coalesce((select min(m.month) from archive_selftest.{u}_compact m), {s}.stream_history_hot_from())
$$;

do $v$
begin
  if not exists (select 1 from pg_views where schemaname = 'archive_selftest' and viewname = '{u}_archive') then
    create view archive_selftest.{u}_archive as
      select null::date as date, null::text as isrc, null::bigint as streams_cumulative where false;
  end if;
  if not exists (select 1 from pg_views where schemaname = 'archive_selftest' and viewname = '{u}_overrides_archive') then
    create view archive_selftest.{u}_overrides_archive as
      select null::bigint as id, null::date as date, null::text as isrc, null::bigint as streams_cumulative_override,
             null::text as note, null::uuid as created_by, null::timestamptz as created_at, null::boolean as base_missing
      where false;
  end if;
end
$v$;

{views_sql(U, N)}
revoke all on archive_selftest.{u}_compact, archive_selftest.{u}_archive, archive_selftest.{u}_overrides_archive,
  archive_selftest.{u}_overrides_all, archive_selftest.{u}_base_all, archive_selftest.{u}_effective from public, anon, authenticated;
grant select on archive_selftest.{u}_compact, archive_selftest.{u}_archive, archive_selftest.{u}_overrides_archive,
  archive_selftest.{u}_overrides_all, archive_selftest.{u}_base_all, archive_selftest.{u}_effective to service_role;
""")
    return "\n".join(parts)


NUL = chr(39) + chr(92) + "N" + chr(39)  # the SQL literal '\N' (backslash N): NULL sentinel in the archive CSV files


def fam(U, test):
    fs = "archive_selftest" if test else "stream_archive"
    return f"{fs}.{U['u']}_rows"


def parents_sql():
    out = []
    for fs in ("stream_archive", "archive_selftest"):
        for U in UNIVERSES:
            out.append(f"""create table if not exists {fs}.{U['u']}_rows (
  kind text, d text, isrc text, v text, oid text, note text, created_by text, created_at text);
alter table {fs}.{U['u']}_rows enable row level security;
revoke all on {fs}.{U['u']}_rows from public, anon, authenticated;
grant select on {fs}.{U['u']}_rows to service_role;""")
    return chr(10).join(out)


def archive_views_sql(U, test):
    """Archive-tier views over the single per-month file family (kind s = stream row, kind o = override row)."""
    N = names(U, test)
    f = fam(U, test)
    return f"""create or replace view {N['arch']} as
  select ops.iso_date(r.d) as date, r.isrc as isrc, r.v::bigint as streams_cumulative
  from {f} r
  where r.kind = 's';

create or replace view {N['arch_ovr']} as
  select r.oid::bigint as id, ops.iso_date(r.d) as date, r.isrc as isrc,
         r.v::bigint as streams_cumulative_override,
         nullif(r.note, {NUL}) as note, nullif(r.created_by, {NUL})::uuid as created_by,
         r.created_at::timestamptz as created_at, null::boolean as base_missing
  from {f} r
  where r.kind = 'o';

create or replace view {N['ovr_all']} as
  select o.id, o.date, o.isrc, o.streams_cumulative_override, o.note, o.created_by, o.created_at,
         null::boolean as base_missing
  from {N['ovr']} o
  union all
  select a.id, a.date, a.isrc, a.streams_cumulative_override, a.note, a.created_by, a.created_at, null::boolean
  from {N['arch_ovr']} a
  where a.date < {N['compact_from']}
    and not exists (select 1 from {N['ovr']} d where d.date = a.date and d.isrc = a.isrc);
"""


def eff_v3_sql(U, test):
    N = names(U, test)
    f = fam(U, test)
    run_t = U["run_t"]
    return f"""create or replace view {N['eff']} as
  select t.date,
         t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative,
         t.source_run_id,
         t.base_created_at,
         (o.id is not null) as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from (
    select d.date, d.isrc, d.streams_cumulative, d.source_run_id, d.created_at as base_created_at
    from {N['daily']} d
    where d.date >= {N['hot_from']}
    union all
    select c.d as date, m.isrc, m.vals[extract(day from c.d)::int] as streams_cumulative,
           null::{run_t} as source_run_id, null::timestamptz as base_created_at
    from (select date '2025-01-01' + g.i as d from generate_series(0, 4017) as g(i)
          where date '2025-01-01' + g.i < {N['hot_from']}) c
    join {N['compact']} m on m.month = date_trunc('month', c.d)::date
    where m.vals[extract(day from c.d)::int] is not null
  ) t
  left join {N['ovr']} o on o.date = t.date and o.isrc = t.isrc
  union all
  -- archive tier: one grouped scan of the month files (stream + override rows together); DB overrides win
  select g.date,
         g.isrc,
         case when db.id is not null then db.streams_cumulative_override else coalesce(g.o_v, g.s_v) end as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         (db.id is not null or g.oid is not null) as is_manual_override,
         case when db.id is not null then db.id else g.oid end as override_id,
         case when db.id is not null then db.note else g.note end as manual_note,
         case when db.id is not null then db.created_at else g.created_at end as manual_created_at,
         case when db.id is not null then db.created_by else g.created_by end as manual_created_by
  from (
    select ops.iso_date(r.d) as date, r.isrc as isrc,
           max(r.v::bigint) filter (where r.kind = 's') as s_v,
           max(r.v::bigint) filter (where r.kind = 'o') as o_v,
           max(r.oid::bigint) filter (where r.kind = 'o') as oid,
           max(nullif(r.note, {NUL})) filter (where r.kind = 'o') as note,
           max(r.created_at::timestamptz) filter (where r.kind = 'o') as created_at,
           (max(nullif(r.created_by, {NUL})) filter (where r.kind = 'o'))::uuid as created_by
    from {f} r
    group by ops.iso_date(r.d), r.isrc
  ) g
  left join {N['ovr']} db on db.date = g.date and db.isrc = g.isrc
  where g.date < {N['compact_from']}
  union all
  -- override-only rows on hot/compact dates (no base row)
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['ovr']} o
  where o.date >= {N['compact_from']}
    and not exists (select 1 from {N['daily']} t
                    where t.date = o.date and t.isrc = o.isrc and t.date >= {N['hot_from']})
    and not exists (select 1 from {N['compact']} m
                    where m.isrc = o.isrc and m.month = date_trunc('month', o.date)::date
                      and m.month < {N['hot_from']}
                      and m.vals[extract(day from o.date)::int] is not null)
  union all
  -- DB overrides on archived dates with no archived row at all (hashed key lookup; evaluated only if such rows exist)
  select o.date,
         o.isrc,
         o.streams_cumulative_override as streams_cumulative,
         null::{run_t} as source_run_id,
         null::timestamptz as base_created_at,
         true as is_manual_override,
         o.id as override_id,
         o.note as manual_note,
         o.created_at as manual_created_at,
         o.created_by as manual_created_by
  from {N['ovr']} o
  where o.date < {N['compact_from']}
    and (o.date, o.isrc) not in (select ops.iso_date(r.d), r.isrc from {f} r);
"""


def v3_migration():
    parts = ["""-- GENERATED by scripts/gen_stream_archive_sql.py (v3) - do not edit by hand.
-- Phase 3 follow-up: ONE gzip-CSV file per universe per month holds both the stream rows (kind s) and the override rows
-- (kind o). With separate stream/override files the effective view had to join archived overrides to archived streams;
-- the planner has no estimates for foreign tables, chose nested loops that re-read the override file per outer row
-- (a 29k-row month took 100 s) and could not window-prune the override side. With one family the archive tier is a
-- single grouped scan of exactly the months inside the query's date range.
-- Column lists/types/order of the effective views are unchanged.
""", parents_sql()]
    for test in (False, True):
        for U in UNIVERSES:
            parts.append(archive_views_sql(U, test))
    for test in (False, True):
        for U in UNIVERSES:
            parts.append(eff_v3_sql(U, test))
    return chr(10).join(parts)


if __name__ == "__main__":
    # 20261012220000/221000/225000 were produced by earlier revisions of this template and are frozen (already applied).
    (MIG / "20261012227000_stream_archive_single_family.sql").write_text(v3_migration(), encoding="utf-8")
    print("written")
