-- Remove the daily partitions whose months are fully packed into the compact tables.
-- OWNER PASTE (run in the Supabase SQL editor). Written 2026-10-12.
--
-- Removes: public.track_daily_streams_y2026m01 .. m06 (own) and competitor.track_daily_streams_y2026m05 .. m06.
-- Frees roughly 158 MB (the compact copies take about 12 MB). NOT reversible except by rebuilding the daily
-- rows from the compact tables (docs/COMPACT-STREAM-STORAGE.md, Rollback): source_run_id / created_at would be lost.
--
-- Run order:  STEP 1 and STEP 2 must each return ZERO ROWS.  Then run STEP 3.  Then STEP 4 (zero rows too).
-- Ingestion keeps writing to the newest partitions and is unaffected. A re-ingest of a date older than
-- 2026-07-01 is skipped with a warning by the ingest scripts (scripts/streambase_postgrest.py).

-- ---------------------------------------------------------------------------------------------------------
-- STEP 1: does any SQL object still read the daily tables (other than the allowed recent-only readers)?
-- Must return 0 rows. Allowed: recent-window functions, the hot-window half of the history views, the packers.
-- If a row appears, that object would lose old months: repoint it before removing anything.
-- ---------------------------------------------------------------------------------------------------------
with allowed(sch, fn) as (values
  ('public','_catchup_plan'),('competitor','_catchup_plan'),
  ('public','spotibase_interpolate_stale_streams'),('competitor','spotibase_interpolate_stale_streams'),
  ('competitor','spotibase_rebase_downward_revisions'),('competitor','spotibase_reconcile_auto_overrides'),
  ('competitor','spotibase_stale_summary'),('public','spotify_availability_candidates'),
  ('public','spotibase_system_stats'),
  ('competitor','home_artist_weekend_dips'),('competitor','home_track_weekend_dips'),
  ('public','_latest_data_sunday'),
  ('public','effective_latest_date'),('public','effective_previous_date'),
  ('competitor','effective_latest_date'),('competitor','effective_previous_date'),
  ('public','pack_stream_month'),('competitor','pack_stream_month'),
  ('public','track_daily_streams_range'),('competitor','track_daily_streams_range'),
  ('public','track_daily_streams_range_isrcs'),('competitor','track_daily_streams_range_isrcs'),
  ('public','ensure_track_daily_streams_partitions'),('competitor','ensure_track_daily_streams_partitions'),
  ('ops','pack_aged_stream_months'))
select 'function' as kind, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','competitor','ops')
  and p.prosrc ~ 'track_daily_streams([^A-Za-z0-9_]|$)'
  and not exists (select 1 from allowed a where a.sch = n.nspname and a.fn = p.proname)
union all
select 'view', c.oid::regclass::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema')
  and pg_get_viewdef(c.oid) ~ 'track_daily_streams([^A-Za-z0-9_]|$)'
  and c.relname not in ('track_daily_streams_base_all','track_daily_streams_effective','track_daily_streams_effective_hot');

-- ---------------------------------------------------------------------------------------------------------
-- STEP 2: is the compact data identical to every partition about to be removed? Must return 0 rows.
-- (Row counts and EXCEPT ALL in both directions, per month.)
-- ---------------------------------------------------------------------------------------------------------
select * from (
select 'public 2026-01' as month, 21429 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m01) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-01-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m01 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-01-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-01-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m01) y) as mismatched_rows
union all
select 'public 2026-02' as month, 76524 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m02) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-02-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m02 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-02-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-02-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m02) y) as mismatched_rows
union all
select 'public 2026-03' as month, 86448 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m03) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-03-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m03 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-03-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-03-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m03) y) as mismatched_rows
union all
select 'public 2026-04' as month, 85387 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m04) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-04-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m04 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-04-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-04-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m04) y) as mismatched_rows
union all
select 'public 2026-05' as month, 87178 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m05) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m05 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m05) y) as mismatched_rows
union all
select 'public 2026-06' as month, 89327 as expected_rows,
       (select count(*) from public.track_daily_streams_y2026m06) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative from public.track_daily_streams_y2026m06 except all select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null except all select date, isrc, streams_cumulative from public.track_daily_streams_y2026m06) y) as mismatched_rows
union all
select 'competitor 2026-05' as month, 109701 as expected_rows,
       (select count(*) from competitor.track_daily_streams_y2026m05) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative, est_revenue_total from competitor.track_daily_streams_y2026m05 except all select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-05-01' and u.v is not null except all select date, isrc, streams_cumulative, est_revenue_total from competitor.track_daily_streams_y2026m05) y) as mismatched_rows
union all
select 'competitor 2026-06' as month, 294132 as expected_rows,
       (select count(*) from competitor.track_daily_streams_y2026m06) as partition_rows,
       (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null) a) as packed_rows,
       (select count(*) from (select date, isrc, streams_cumulative, est_revenue_total from competitor.track_daily_streams_y2026m06 except all select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null) x)
     + (select count(*) from (select (m.month + (u.d - 1)::int), m.isrc, u.v, competitor.stream_est_revenue(u.v) from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d) where m.month = date '2026-06-01' and u.v is not null except all select date, isrc, streams_cumulative, est_revenue_total from competitor.track_daily_streams_y2026m06) y) as mismatched_rows
) z
where partition_rows <> expected_rows or packed_rows <> expected_rows or mismatched_rows <> 0;

-- ---------------------------------------------------------------------------------------------------------
-- STEP 3: remove the partitions (single transaction).
-- ---------------------------------------------------------------------------------------------------------
begin;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m01;
drop table public.track_daily_streams_y2026m01;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m02;
drop table public.track_daily_streams_y2026m02;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m03;
drop table public.track_daily_streams_y2026m03;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m04;
drop table public.track_daily_streams_y2026m04;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m05;
drop table public.track_daily_streams_y2026m05;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m06;
drop table public.track_daily_streams_y2026m06;
alter table competitor.track_daily_streams detach partition competitor.track_daily_streams_y2026m05;
drop table competitor.track_daily_streams_y2026m05;
alter table competitor.track_daily_streams detach partition competitor.track_daily_streams_y2026m06;
drop table competitor.track_daily_streams_y2026m06;
commit;

-- ---------------------------------------------------------------------------------------------------------
-- STEP 4: post-check. 4a and 4b must return 0 rows.
-- ---------------------------------------------------------------------------------------------------------
-- 4a: the history views still return exactly the verified row counts for every removed month.
select 'public' as universe, e.month, e.rows as expected_rows,
       (select count(*) from public.track_daily_streams_all a where a.date >= e.month and a.date < e.month + interval '1 month') as view_rows
from (values
  ('2026-01-01'::date, 21429),
  ('2026-02-01'::date, 76524),
  ('2026-03-01'::date, 86448),
  ('2026-04-01'::date, 85387),
  ('2026-05-01'::date, 87178),
  ('2026-06-01'::date, 89327)
) as e(month, rows)
where (select count(*) from public.track_daily_streams_all a where a.date >= e.month and a.date < e.month + interval '1 month') <> e.rows
union all
select 'competitor', e.month, e.rows,
       (select count(*) from competitor.track_daily_streams_all a where a.date >= e.month and a.date < e.month + interval '1 month')
from (values
  ('2026-05-01'::date, 109701),
  ('2026-06-01'::date, 294132)
) as e(month, rows)
where (select count(*) from competitor.track_daily_streams_all a where a.date >= e.month and a.date < e.month + interval '1 month') <> e.rows;

-- 4b: none of the removed partitions is still present.
select c.oid::regclass::text as still_present
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'public' and c.relname ~ '^track_daily_streams_y2026m0[1-6]$')
   or (n.nspname = 'competitor' and c.relname ~ '^track_daily_streams_y2026m0[5-6]$');

-- 4c (informational): database size, and an old-date reader still answering.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select count(*) as rows_on_2026_03_10 from public.effective_streams_for_date('2026-03-10');
