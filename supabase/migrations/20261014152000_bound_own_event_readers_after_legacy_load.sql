-- The recovered 2023-07..2025-12 history lowers stream_compact_from() to 2023-07. Event-style readers
-- that used compact_from() as their implicit lower bound would now scan (and report events from) 2023+.
-- Bound them to the last 365 days (or the caller's explicit start for the spike scan), as before in effect.
do $$
declare
  spec text[][] := array[
    ['public.health_unplayable_candidates(date,integer)',
     's.date >= public.stream_compact_from()',
     's.date >= greatest(public.stream_compact_from(), $1 - 365)'],
    ['public.home_negative_daily_streams()',
     'e.date >= public.stream_compact_from()',
     'e.date >= greatest(public.stream_compact_from(), current_date - 365)'],
    ['public.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date)',
     'tds.date >= public.stream_compact_from()',
     'tds.date >= greatest(public.stream_compact_from(), coalesce(p_start_date, current_date - 365))']
  ];
  i int;
  def text;
  newdef text;
begin
  for i in 1..array_length(spec, 1) loop
    def := pg_get_functiondef(spec[i][1]::regprocedure);
    newdef := replace(def, spec[i][2], spec[i][3]);
    if newdef = def then
      raise exception 'pattern not found in %', spec[i][1];
    end if;
    execute newdef;
  end loop;
end $$;
notify pgrst, 'reload schema';
