-- Home "Change by release week": per-track streams for the latest 7 run dates vs the 7 before.
-- Reads the effective (override-aware) public view with LITERAL date bounds (dynamic SQL) so
-- partition pruning works (a join-derived bound scans every hot+compact row: ~5 s vs ~0.1 s).
-- Window is always inside the hot tier (15 days), so no archive/compact scan.
-- Daily = positive delta of cumulative; negative deltas (counter resets) are excluded from the
-- sums and reported separately (reset_drop / reset_run_date) so the UI can footnote them.

create or replace function public.home_release_week_tracks(p_run_date date default null)
returns table (
  isrc text,
  name text,
  artist_names text[],
  release_date date,
  prev_streams bigint,
  cur_streams bigint,
  reset_drop bigint,
  reset_run_date date,
  run_date date
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r date;
begin
  r := coalesce(
    p_run_date,
    (select max(s.date) from public.track_daily_streams s where s.date >= current_date - 14)
  );
  if r is null then
    return;
  end if;

  return query execute format($q$
    with x as (
      select s.date, s.isrc,
             s.streams_cumulative - lag(s.streams_cumulative) over (partition by s.isrc order by s.date) as d
      from public.track_daily_streams_effective_public s
      where s.date between %1$L::date - 14 and %1$L::date
    ),
    agg as (
      select x.isrc,
             sum(greatest(x.d, 0)) filter (where x.date >  %1$L::date - 7)::bigint as cur,
             sum(greatest(x.d, 0)) filter (where x.date <= %1$L::date - 7 and x.date > %1$L::date - 14)::bigint as prev,
             sum(least(x.d, 0)) filter (where x.date > %1$L::date - 14)::bigint as neg,
             (array_agg(x.date order by x.d asc) filter (where x.d < 0 and x.date > %1$L::date - 14))[1] as neg_date
      from x
      group by x.isrc
    )
    select a.isrc, t.name, t.spotify_artist_names, t.release_date::date,
           a.prev, a.cur, nullif(a.neg, 0), a.neg_date, %1$L::date
    from agg a
    join public.tracks t on t.isrc = a.isrc
  $q$, r);
end
$$;

revoke all on function public.home_release_week_tracks(date) from public, anon;
grant execute on function public.home_release_week_tracks(date) to authenticated, service_role;

comment on function public.home_release_week_tracks(date) is
  'Home release-week cohorts: per own-catalog track, positive streams over the 7 run dates ending p_run_date (default latest) vs the 7 before, plus counter-reset drops. UI groups by Friday-start release week.';
