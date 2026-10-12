-- Remove the July + August 2026 daily partitions (both universes), now packed into track_streams_monthly.
-- OWNER PASTE. Run in the Supabase SQL editor of the **SpotiBase** project (ref ucbbxzotbhkehjgbvdfm), NOT songsleeve.
-- Frees roughly 160 MB. Run the steps one at a time: STEP 1 must return ZERO ROWS before you run STEP 2.

-- ---------------------------------------------------------------------------------------------------------
-- STEP 1: the compact copy must be identical to every partition being removed. Must return 0 rows.
-- ---------------------------------------------------------------------------------------------------------
with months(sch, m) as (values ('public', date '2026-07-01'), ('public', date '2026-08-01'),
                               ('competitor', date '2026-07-01'), ('competitor', date '2026-08-01')),
packed as (
  select 'public' sch, (m.month + (u.d - 1)::int) as date, m.isrc, u.v
  from public.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month in (date '2026-07-01', date '2026-08-01') and u.v is not null
  union all
  select 'competitor', (m.month + (u.d - 1)::int), m.isrc, u.v
  from competitor.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month in (date '2026-07-01', date '2026-08-01') and u.v is not null),
raw as (
  select 'public' sch, date, isrc, streams_cumulative as v from public.track_daily_streams_y2026m07
  union all select 'public', date, isrc, streams_cumulative from public.track_daily_streams_y2026m08
  union all select 'competitor', date, isrc, streams_cumulative from competitor.track_daily_streams_y2026m07
  union all select 'competitor', date, isrc, streams_cumulative from competitor.track_daily_streams_y2026m08)
select 'mismatch' as problem, count(*) as n from (
  (select * from raw except all select * from packed)
  union all
  (select * from packed except all select * from raw)) x
having count(*) > 0
union all
select 'history not served from compact yet', 1
where public.stream_history_hot_from() < date '2026-09-01' or competitor.stream_history_hot_from() < date '2026-09-01';

-- ---------------------------------------------------------------------------------------------------------
-- STEP 2: remove the partitions (single transaction).
-- ---------------------------------------------------------------------------------------------------------
begin;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m07;
drop table public.track_daily_streams_y2026m07;
alter table public.track_daily_streams detach partition public.track_daily_streams_y2026m08;
drop table public.track_daily_streams_y2026m08;
alter table competitor.track_daily_streams detach partition competitor.track_daily_streams_y2026m07;
drop table competitor.track_daily_streams_y2026m07;
alter table competitor.track_daily_streams detach partition competitor.track_daily_streams_y2026m08;
drop table competitor.track_daily_streams_y2026m08;
commit;

-- ---------------------------------------------------------------------------------------------------------
-- STEP 3: post-check. Expect own Jul 94288 / Aug 96162 and competitor Jul 309904 / Aug 349825 rows in the
-- effective views (counted before removal, overrides included), and the new database size.
-- ---------------------------------------------------------------------------------------------------------
select 'own' u, date_trunc('month', date)::date m, count(*) from public.track_daily_streams_effective
where date between '2026-07-01' and '2026-08-31' group by 2
union all
select 'competitor', date_trunc('month', date)::date, count(*) from competitor.track_daily_streams_effective
where date between '2026-07-01' and '2026-08-31' group by 2
order by 1, 2;
select pg_size_pretty(pg_database_size(current_database())) as database_size;
