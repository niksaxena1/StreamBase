-- Phase 2 / step 2f: readers that only ever want the latest and previous snapshot (they find those dates with
-- MAX(date) over the whole effective view) read a hot-window effective view instead. Identical rows for dates
-- >= stream_history_hot_from(); packed months are not scanned at all (they scanned the full history before,
-- which the history-aware view made ~1.6x slower).
-- Grants mirror <schema>.track_daily_streams_effective_public.
create or replace view public.track_daily_streams_effective_hot as
  select t.date, t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative
  from public.track_daily_streams t
  left join public.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
  where t.date >= public.stream_history_hot_from()
  union all
  select o.date, o.isrc, o.streams_cumulative_override as streams_cumulative
  from public.track_daily_stream_overrides o
  where o.date >= public.stream_history_hot_from()
    and not exists (select 1 from public.track_daily_streams t where t.date = o.date and t.isrc = o.isrc);
revoke all on public.track_daily_streams_effective_hot from anon, authenticated;
grant select on public.track_daily_streams_effective_hot to anon, authenticated, service_role, claw_spotibase_readonly;

create or replace view competitor.track_daily_streams_effective_hot as
  select t.date, t.isrc,
         coalesce(o.streams_cumulative_override, t.streams_cumulative) as streams_cumulative
  from competitor.track_daily_streams t
  left join competitor.track_daily_stream_overrides o on o.date = t.date and o.isrc = t.isrc
  where t.date >= competitor.stream_history_hot_from()
  union all
  select o.date, o.isrc, o.streams_cumulative_override as streams_cumulative
  from competitor.track_daily_stream_overrides o
  where o.date >= competitor.stream_history_hot_from()
    and not exists (select 1 from competitor.track_daily_streams t where t.date = o.date and t.isrc = o.isrc);
revoke all on competitor.track_daily_streams_effective_hot from anon, authenticated;
grant select on competitor.track_daily_streams_effective_hot to anon, authenticated, service_role;

do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in
    select * from (values
      ('public.catalog_config_track_rows(integer,integer)'::text, 'public'::text),
      ('public.catalog_config_artist_rows(integer,integer,integer)', 'public'),
      ('public.network_selection_scoped_track_totals(text[],text,boolean)', 'public'),
      ('public.network_export_artist_stream_stats(text[],text,boolean)', 'public'),
      ('competitor.network_selection_scoped_track_totals(text[],text,boolean)', 'competitor')
    ) as v(sig, sch)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := replace(def, r.sch || '.track_daily_streams_effective_public', r.sch || '.track_daily_streams_effective_hot');
    if newdef = def then
      raise exception 'hot repoint: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;
end
$$;
