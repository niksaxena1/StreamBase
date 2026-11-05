-- Home "Change by release week" competitor comparison (admin-only, read via service role).
-- Same math as public.home_release_week_rows: positive deltas of cumulative streams over the
-- 7 run dates ending r vs the 7 before; negative deltas (counter resets) are excluded.
-- Literal date bounds via EXECUTE format(%L) so the effective view prunes partitions.
-- Track -> competitor via current playlist memberships (a track on two labels counts for both).

create or replace function competitor.release_week_summary(p_run_date date default null)
returns table (
  label_key text,
  release_date date,
  tracks integer,
  prev_streams bigint,
  cur_streams bigint,
  run_date date
)
language plpgsql
stable
set search_path = competitor, public, pg_temp
as $$
declare
  r date;
begin
  r := coalesce(
    p_run_date,
    (select max(s.date) from competitor.track_daily_streams s where s.date >= current_date - 14)
  );
  if r is null then
    return;
  end if;

  return query execute format($q$
    with x as (
      select s.date, s.isrc,
             s.streams_cumulative - lag(s.streams_cumulative) over (partition by s.isrc order by s.date) as d
      from competitor.track_daily_streams_effective_public s
      where s.date between %1$L::date - 14 and %1$L::date
    ),
    agg as (
      select x.isrc,
             sum(greatest(x.d, 0)) filter (where x.date >  %1$L::date - 7)::bigint as cur,
             sum(greatest(x.d, 0)) filter (where x.date <= %1$L::date - 7 and x.date > %1$L::date - 14)::bigint as prev
      from x
      group by x.isrc
    ),
    lab as (
      select distinct m.isrc, p.label_key
      from competitor.playlist_memberships m
      join competitor.playlists p on p.playlist_key = m.playlist_key
      where m.valid_to is null
    )
    select l.label_key, t.release_date::date, count(*)::int,
           coalesce(sum(a.prev), 0)::bigint, coalesce(sum(a.cur), 0)::bigint, %1$L::date
    from agg a
    join lab l on l.isrc = a.isrc
    join competitor.tracks t on t.isrc = a.isrc
    group by l.label_key, t.release_date
  $q$, r);
end
$$;

create or replace function competitor.release_week_tracks(
  p_run_date date,
  p_label_key text,
  p_from date,
  p_to date,
  p_limit integer default 100
)
returns table (
  isrc text,
  name text,
  artist_names text[],
  album_image_url text,
  release_date date,
  prev_streams bigint,
  cur_streams bigint,
  reset_drop bigint
)
language plpgsql
stable
set search_path = competitor, public, pg_temp
as $$
begin
  if p_run_date is null or p_label_key is null then
    return;
  end if;

  return query execute format($q$
    with lab as (
      select distinct m.isrc
      from competitor.playlist_memberships m
      join competitor.playlists p on p.playlist_key = m.playlist_key
      join competitor.tracks t on t.isrc = m.isrc
      where m.valid_to is null
        and p.label_key = %2$L
        and (case when %3$L::date is null then t.release_date is null
                  else t.release_date between %3$L::date and %4$L::date end)
    ),
    x as (
      select s.date, s.isrc,
             s.streams_cumulative - lag(s.streams_cumulative) over (partition by s.isrc order by s.date) as d
      from competitor.track_daily_streams_effective_public s
      where s.date between %1$L::date - 14 and %1$L::date
        and s.isrc in (select lab.isrc from lab)
    ),
    agg as (
      select x.isrc,
             sum(greatest(x.d, 0)) filter (where x.date >  %1$L::date - 7)::bigint as cur,
             sum(greatest(x.d, 0)) filter (where x.date <= %1$L::date - 7 and x.date > %1$L::date - 14)::bigint as prev,
             sum(least(x.d, 0)) filter (where x.date > %1$L::date - 14)::bigint as neg
      from x
      group by x.isrc
    )
    select a.isrc, t.name, t.spotify_artist_names, t.spotify_album_image_url, t.release_date::date,
           a.prev, a.cur, nullif(a.neg, 0)
    from agg a
    join competitor.tracks t on t.isrc = a.isrc
    order by coalesce(a.cur, 0) - coalesce(a.prev, 0) asc, a.isrc
    limit %5$s
  $q$, p_run_date, p_label_key, p_from, p_to, greatest(1, least(coalesce(p_limit, 100), 500)));
end
$$;

revoke all on function competitor.release_week_summary(date) from public, anon, authenticated;
revoke all on function competitor.release_week_tracks(date, text, date, date, integer) from public, anon, authenticated;
grant execute on function competitor.release_week_summary(date) to service_role;
grant execute on function competitor.release_week_tracks(date, text, date, date, integer) to service_role;

comment on function competitor.release_week_summary(date) is
  'Home release-week comparison: per competitor label and release date, positive streams over the 7 run dates ending p_run_date vs the 7 before (counter resets excluded). Service role only.';
comment on function competitor.release_week_tracks(date, text, date, date, integer) is
  'Home release-week drill-down: one competitor''s tracks released in [p_from, p_to] (null p_from = no release date), biggest drop first. Service role only.';
