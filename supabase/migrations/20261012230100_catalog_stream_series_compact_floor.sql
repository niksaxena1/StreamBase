-- Applied live as version 20261012174426.
-- Per AGENTS.md: page reads of stream history are floored at stream_compact_from() (no archive-tier reads).
create or replace function catalog.track_stream_series(p_catalog_id text, p_days integer default 90)
returns table (date date, streams_cumulative bigint)
language sql stable set search_path = '' as $$
  select s.date, s.streams_cumulative
  from catalog.track_isrcs i,
       public.track_daily_streams_range_isrcs(
         greatest(public.effective_latest_date() - least(greatest(p_days, 7), 730), public.stream_compact_from()),
         public.effective_latest_date(), array[i.isrc]) s
  where i.catalog_id = p_catalog_id and i.is_primary
  order by s.date
$$;
revoke execute on function catalog.track_stream_series(text, integer) from public, anon, authenticated;
grant execute on function catalog.track_stream_series(text, integer) to service_role;
