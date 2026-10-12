-- Phase 2 / step 2b: where the caller supplies an ISRC array or a single date, call the range functions
-- directly. Going through the view with an array from a CTE planned badly (7 s vs 80 ms).
do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in select * from (values
      ('public.catalog_artist_series_fast(text,date,date)'::text, 'public'::text),
      ('competitor.catalog_artist_series_fast(text,date,date)', 'competitor')
    ) as v(sig, sch)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := replace(def,
      'FROM ' || r.sch || '.track_daily_streams_all b' || E'\n      CROSS JOIN artist_isrcs a\n      WHERE b.isrc = ANY (a.arr)\n        AND b.date BETWEEN $2 AND $3',
      'FROM artist_isrcs a' || E'\n      CROSS JOIN LATERAL ' || r.sch || '.track_daily_streams_range_isrcs($2, $3, a.arr) b');
    if newdef = def then
      raise exception 'range repoint: no change for %', r.sig;
    end if;
    execute newdef;
  end loop;

  def := pg_get_functiondef('public.effective_streams_for_date(date)'::regprocedure);
  newdef := replace(def, 'FROM public.track_daily_streams_all b', 'FROM public.track_daily_streams_range(p_date, p_date) b');
  if newdef = def then
    raise exception 'range repoint: no change for effective_streams_for_date';
  end if;
  execute newdef;
end
$$;
