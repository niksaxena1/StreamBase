-- Applied live as versions 20261012184202 (catalog_stream_series_effective) and
-- 20261012184242 (catalog_stream_series_effective_fast); this file is the final state.
-- Chart series reads the effective history (overrides and catch-up smoothing applied, like every
-- other StreamBase chart) instead of raw daily rows, which repeat a total on days a count didn't
-- update and then double the next day. Still floored at stream_compact_from() (AGENTS.md).
-- Looks up the ISRC first so the effective view is planned for one ISRC (~0.2 s).
create or replace function catalog.track_stream_series(p_catalog_id text, p_days integer default 90)
returns table (date date, streams_cumulative bigint)
language plpgsql stable set search_path = '' as $$
declare v_isrc text; v_end date; v_start date;
begin
  select i.isrc into v_isrc from catalog.track_isrcs i where i.catalog_id = p_catalog_id and i.is_primary limit 1;
  if v_isrc is null then return; end if;
  v_end := public.effective_latest_date();
  v_start := greatest(v_end - least(greatest(p_days, 7), 730), public.stream_compact_from());
  return query execute
    'select e.date, e.streams_cumulative from public.track_daily_streams_effective e
      where e.isrc = $1 and e.date >= $2 and e.date <= $3 order by e.date'
    using v_isrc, v_start, v_end;
end $$;
revoke execute on function catalog.track_stream_series(text, integer) from public, anon, authenticated;
grant execute on function catalog.track_stream_series(text, integer) to service_role;
