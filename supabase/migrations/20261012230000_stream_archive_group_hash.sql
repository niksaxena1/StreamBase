-- Phase 3 follow-up: the archive-tier grouped scan used `isrc` as a plain column in GROUP BY; the planner then asked the
-- S3 foreign data wrapper for a sort pushdown on isrc, which the wrapper executes ~10x slower than reading the file
-- (10.8 s vs 1.2 s for one competitor month, i.e. a 2-day query took 13 s). (isrc || '') is not a column, so no foreign
-- sort is requested and PostgreSQL aggregates the rows itself. Same output, same column lists.
-- (scripts/gen_stream_archive_sql.py already emits this form; this migration rewrites the four applied views in place.)
do $$
declare
  v text;
  def text;
  newdef text;
begin
  foreach v in array array[
    'public.track_daily_streams_effective',
    'competitor.track_daily_streams_effective',
    'archive_selftest.own_effective',
    'archive_selftest.competitor_effective']
  loop
    def := pg_get_viewdef(v::regclass);
    newdef := regexp_replace(def, '(AS date,\s+)r\.isrc,(\s+max\(\(r\.v\))', E'\\1(r.isrc || ''''::text) AS isrc,\\2');
    newdef := regexp_replace(newdef, 'GROUP BY \(ops\.iso_date\(r\.d\)\), r\.isrc\) g', 'GROUP BY (ops.iso_date(r.d)), (r.isrc || ''''::text)) g');
    if newdef = def or position('r.isrc || ' in newdef) = 0 then
      raise exception 'group-by rewrite did not apply to %', v;
    end if;
    execute 'create or replace view ' || v || ' as ' || newdef;
  end loop;
end
$$;
