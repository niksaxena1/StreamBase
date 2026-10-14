-- Recovered 2023-2025 data has days where some tracks have no value (coverage gaps in the old collector). Summing only
-- the present tracks makes the artist cumulative dip by that track's whole total and jump back the next day (+-100M).
-- Carry each track's last known cumulative forward (at most 7 days) so the artist series stays consistent.
create or replace function public.catalog_artist_series_cold(artist_id text, start_date date, end_date date)
returns table (date date, streams_cumulative bigint)
language sql stable
as $$
  with a as (select array_agg(t.isrc) as arr from public.tracks t where t.spotify_artist_ids @> array[artist_id]::text[]),
  pts as (
    select c.date, c.isrc, c.streams_cumulative as v
    from a cross join lateral public.stream_cold_range(start_date, end_date, a.arr) c
  ),
  dates as (select distinct p.date from pts p),
  firsts as (select p.isrc, min(p.date) as f from pts p group by p.isrc),
  grid as (
    select d.date, f.isrc, p.v
    from dates d
    join firsts f on d.date >= f.f
    left join pts p on p.date = d.date and p.isrc = f.isrc
  ),
  g1 as (select g.*, count(g.v) over (partition by g.isrc order by g.date) as grp from grid g),
  g2 as (
    select g1.date, g1.isrc,
           coalesce(g1.v, max(g1.v) over (partition by g1.isrc, g1.grp)) as fv,
           g1.date - min(g1.date) over (partition by g1.isrc, g1.grp) as lag_days
    from g1
  )
  select g2.date, sum(g2.fv)::bigint
  from g2
  where g2.fv is not null and g2.lag_days <= 7
  group by g2.date
  order by g2.date
$$;
