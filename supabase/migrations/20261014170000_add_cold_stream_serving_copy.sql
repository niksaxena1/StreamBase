-- Cold serving copy of archived stream months (own catalog).
-- Measured after the Phase 4 archive: one archived monthly R2 file takes about 8 s to read through the S3 FDW
-- (the PostgREST role timeout is 8 s and many parallel foreign scans exhaust worker threads), so charts cannot read
-- the archive tier interactively. R2 stays the verified long-term copy; this table is the small (compact-format)
-- copy the web reads server-side with the service role for ranges older than stream_compact_from().
create table if not exists public.track_streams_monthly_cold (
  isrc      text        not null,
  month     date        not null,
  vals      bigint[]    not null,
  packed_at timestamptz not null default now(),
  primary key (isrc, month),
  constraint track_streams_monthly_cold_month_first_day check (month = date_trunc('month', month)::date)
);
alter table public.track_streams_monthly_cold enable row level security;
revoke all on public.track_streams_monthly_cold from anon, authenticated;
grant all on public.track_streams_monthly_cold to service_role;

-- Daily points for months older than the compact tier (never overlaps track_daily_streams_effective_public).
create or replace function public.stream_cold_range(p_start date, p_end date, p_isrcs text[])
returns table (date date, isrc text, streams_cumulative bigint)
language sql stable
as $$
  select (m.month + (u.d - 1)::int) as date, m.isrc, u.v
  from public.track_streams_monthly_cold m
  cross join lateral unnest(m.vals) with ordinality as u(v, d)
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and m.month < public.stream_compact_from()
    and m.isrc = any (p_isrcs)
    and u.v is not null
    and (m.month + (u.d - 1)::int) between p_start and p_end
$$;

create or replace function public.catalog_artist_series_cold(artist_id text, start_date date, end_date date)
returns table (date date, streams_cumulative bigint)
language sql stable
as $$
  with a as (select array_agg(t.isrc) as arr from public.tracks t where t.spotify_artist_ids @> array[artist_id]::text[])
  select c.date, sum(c.streams_cumulative)::bigint
  from a cross join lateral public.stream_cold_range(start_date, end_date, a.arr) c
  group by c.date
  order by c.date
$$;

-- Called by the archive workflow before finalize so a newly archived month stays chartable.
create or replace function public.stream_cold_copy_month(p_month date)
returns bigint
language plpgsql
as $$
declare n bigint;
begin
  insert into public.track_streams_monthly_cold as c (isrc, month, vals)
  select m.isrc, m.month, m.vals from public.track_streams_monthly m where m.month = date_trunc('month', p_month)::date
  on conflict (isrc, month) do update set vals = excluded.vals, packed_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.stream_cold_range(date, date, text[]) from public, anon, authenticated;
revoke all on function public.catalog_artist_series_cold(text, date, date) from public, anon, authenticated;
revoke all on function public.stream_cold_copy_month(date) from public, anon, authenticated;
grant execute on function public.stream_cold_range(date, date, text[]) to service_role;
grant execute on function public.catalog_artist_series_cold(text, date, date) to service_role;
grant execute on function public.stream_cold_copy_month(date) to service_role;
notify pgrst, 'reload schema';
