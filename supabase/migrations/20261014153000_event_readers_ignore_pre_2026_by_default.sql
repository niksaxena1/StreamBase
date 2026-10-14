-- Follow-up: recovered 2023-2025 history must not surface as live Health/Home events.
-- Default floor for the three event-style readers is 2026-01-01 (never earlier than 365 days back).
do $$
declare
  spec text[][] := array[
    ['public.health_unplayable_candidates(date,integer)',
     'greatest(public.stream_compact_from(), $1 - 365)',
     'greatest(public.stream_compact_from(), date ''2026-01-01'', $1 - 365)'],
    ['public.home_negative_daily_streams()',
     'greatest(public.stream_compact_from(), current_date - 365)',
     'greatest(public.stream_compact_from(), date ''2026-01-01'', current_date - 365)'],
    ['public.home_artificial_stream_spikes(numeric,numeric,integer,bigint,boolean,date,date)',
     'coalesce(p_start_date, current_date - 365)',
     'coalesce(p_start_date, greatest(date ''2026-01-01'', current_date - 365))']
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
