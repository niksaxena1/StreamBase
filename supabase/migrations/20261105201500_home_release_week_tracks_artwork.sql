-- Home release weeks: add album artwork (tracks.spotify_album_image_url) to home_release_week_tracks.
-- Return type changes and CREATE OR REPLACE can't do that, so this is a new function
-- (home_release_week_rows); the old home_release_week_tracks is unused after this and can be dropped later.

create or replace function public.home_release_week_rows(p_run_date date default null)
returns table (
  isrc text,
  name text,
  artist_names text[],
  album_image_url text,
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
    select a.isrc, t.name, t.spotify_artist_names, t.spotify_album_image_url, t.release_date::date,
           a.prev, a.cur, nullif(a.neg, 0), a.neg_date, %1$L::date
    from agg a
    join public.tracks t on t.isrc = a.isrc
  $q$, r);
end
$$;

revoke all on function public.home_release_week_rows(date) from public, anon;
grant execute on function public.home_release_week_rows(date) to authenticated, service_role;

comment on function public.home_release_week_rows(date) is
  'Home release-week cohorts: per own-catalog track, positive streams over the 7 run dates ending p_run_date (default latest) vs the 7 before, plus counter-reset drops. UI groups by Friday-start release week.';
