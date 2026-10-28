-- Charts universe: daily snapshots of public music charts (first: Beatport Tech House Top 100).
-- Separate `charts` schema; never joins own-catalog or competitor analytics tables.
-- Server-side reads only (service_role after the app's auth gate), like the competitor schema.

create schema if not exists charts;
grant usage on schema charts to service_role;

create table if not exists charts.charts (
  chart_key     text primary key,
  source        text not null,
  display_name  text not null,
  genre_name    text,
  url           text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists charts.tracks (
  source           text not null,
  source_track_id  bigint not null,
  isrc             text,
  name             text not null,
  mix_name         text,
  artists          text[] not null default '{}',
  remixers         text[] not null default '{}',
  label_name       text,
  release_name     text,
  release_date     date,
  bpm              integer,
  musical_key      text,
  camelot          text,
  length_ms        integer,
  image_url        text,
  track_url        text,
  first_seen       date not null,
  last_seen        date not null,
  updated_at       timestamptz not null default now(),
  primary key (source, source_track_id)
);
create index if not exists tracks_isrc_idx on charts.tracks (isrc);

create table if not exists charts.snapshots (
  chart_key      text not null references charts.charts(chart_key),
  snapshot_date  date not null,
  captured_at    timestamptz not null default now(),
  entry_count    integer not null,
  primary key (chart_key, snapshot_date)
);

create table if not exists charts.entries (
  chart_key        text not null,
  snapshot_date    date not null,
  position         smallint not null check (position between 1 and 500),
  source           text not null,
  source_track_id  bigint not null,
  primary key (chart_key, snapshot_date, position),
  foreign key (chart_key, snapshot_date) references charts.snapshots(chart_key, snapshot_date) on delete cascade,
  foreign key (source, source_track_id) references charts.tracks(source, source_track_id)
);
create index if not exists entries_track_idx on charts.entries (chart_key, source, source_track_id, snapshot_date);

alter table charts.charts    enable row level security;
alter table charts.tracks    enable row level security;
alter table charts.snapshots enable row level security;
alter table charts.entries   enable row level security;
grant all on all tables in schema charts to service_role;

insert into charts.charts (chart_key, source, display_name, genre_name, url)
values ('beatport_tech_house_top100', 'beatport', 'Beatport Tech House Top 100', 'Tech House',
        'https://www.beatport.com/genre/tech-house/11/top-100')
on conflict (chart_key) do nothing;

-- Entries for one snapshot with movement against the nearest snapshot at least p_compare_days earlier.
create or replace function charts.chart_movement(p_chart_key text, p_date date default null, p_compare_days integer default 7)
returns table (
  snapshot_date date, compare_date date, "position" smallint, source text, source_track_id bigint,
  name text, mix_name text, artists text[], remixers text[], label_name text, release_date date,
  bpm integer, musical_key text, camelot text, image_url text, track_url text, isrc text,
  prev_position smallint, position_change integer, is_new boolean, is_reentry boolean,
  days_on_chart integer, peak_position smallint, first_charted date
)
language sql stable
set search_path = charts, pg_temp
as $$
  with d as (
    select coalesce(p_date, (select max(s.snapshot_date) from charts.snapshots s where s.chart_key = p_chart_key)) as d
  ), c as (
    select (select max(s.snapshot_date) from charts.snapshots s
            where s.chart_key = p_chart_key and s.snapshot_date <= (select d from d) - greatest(p_compare_days, 1)) as c
  ), cur as (
    select e.* from charts.entries e where e.chart_key = p_chart_key and e.snapshot_date = (select d from d)
  ), hist as (
    select e.source, e.source_track_id, count(distinct e.snapshot_date)::int as days_on_chart,
           min(e.position) as peak_position, min(e.snapshot_date) as first_charted
    from charts.entries e
    where e.chart_key = p_chart_key and e.snapshot_date <= (select d from d)
      and (e.source, e.source_track_id) in (select source, source_track_id from cur)
    group by 1, 2
  )
  select cur.snapshot_date, (select c from c), cur.position, cur.source, cur.source_track_id,
         t.name, t.mix_name, t.artists, t.remixers, t.label_name, t.release_date,
         t.bpm, t.musical_key, t.camelot, t.image_url, t.track_url, t.isrc,
         prev.position,
         case when prev.position is null then null else prev.position - cur.position end,
         h.first_charted = cur.snapshot_date and (select c from c) is not null,
         prev.position is null and h.first_charted < cur.snapshot_date and (select c from c) is not null,
         h.days_on_chart, h.peak_position, h.first_charted
  from cur
  join charts.tracks t on t.source = cur.source and t.source_track_id = cur.source_track_id
  join hist h on h.source = cur.source and h.source_track_id = cur.source_track_id
  left join charts.entries prev on prev.chart_key = p_chart_key and prev.snapshot_date = (select c from c)
       and prev.source = cur.source and prev.source_track_id = cur.source_track_id
  order by cur.position;
$$;

-- Tracks on the comparison snapshot that are no longer on the chart.
create or replace function charts.chart_dropouts(p_chart_key text, p_date date default null, p_compare_days integer default 7)
returns table (compare_date date, prev_position smallint, source text, source_track_id bigint,
               name text, mix_name text, artists text[], label_name text, image_url text, track_url text)
language sql stable
set search_path = charts, pg_temp
as $$
  with d as (
    select coalesce(p_date, (select max(s.snapshot_date) from charts.snapshots s where s.chart_key = p_chart_key)) as d
  ), c as (
    select (select max(s.snapshot_date) from charts.snapshots s
            where s.chart_key = p_chart_key and s.snapshot_date <= (select d from d) - greatest(p_compare_days, 1)) as c
  )
  select p.snapshot_date, p.position, p.source, p.source_track_id, t.name, t.mix_name, t.artists, t.label_name, t.image_url, t.track_url
  from charts.entries p
  join charts.tracks t on t.source = p.source and t.source_track_id = p.source_track_id
  where p.chart_key = p_chart_key and p.snapshot_date = (select c from c)
    and not exists (select 1 from charts.entries e where e.chart_key = p_chart_key and e.snapshot_date = (select d from d)
                    and e.source = p.source and e.source_track_id = p.source_track_id)
  order by p.position;
$$;

-- Daily positions for one track (absent days are simply missing rows).
create or replace function charts.track_chart_history(p_chart_key text, p_source text, p_source_track_id bigint, p_days integer default 90)
returns table (snapshot_date date, "position" smallint)
language sql stable
set search_path = charts, pg_temp
as $$
  select e.snapshot_date, e.position from charts.entries e
  where e.chart_key = p_chart_key and e.source = p_source and e.source_track_id = p_source_track_id
    and e.snapshot_date > current_date - greatest(p_days, 1)
  order by e.snapshot_date;
$$;

revoke all on function charts.chart_movement(text, date, integer) from public, anon, authenticated;
revoke all on function charts.chart_dropouts(text, date, integer) from public, anon, authenticated;
revoke all on function charts.track_chart_history(text, text, bigint, integer) from public, anon, authenticated;
grant execute on function charts.chart_movement(text, date, integer) to service_role;
grant execute on function charts.chart_dropouts(text, date, integer) to service_role;
grant execute on function charts.track_chart_history(text, text, bigint, integer) to service_role;

-- Expose the schema to the Data API (service_role only by the grants above).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, competitor, playlist_watch, catalog, charts';
notify pgrst, 'reload config';
