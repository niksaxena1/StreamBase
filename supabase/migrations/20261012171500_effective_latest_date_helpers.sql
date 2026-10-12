-- Phase 2 / step 2g: "latest / previous snapshot date" without scanning a view. These are index-only MAX
-- lookups on the (recent) daily partitions and the overrides table; the answer is identical to
-- MAX(date) over the effective view because both tables' newest dates are always in the hot window.
create or replace function public.effective_latest_date()
returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  select greatest((select max(b.date) from public.track_daily_streams b),
                  (select max(o.date) from public.track_daily_stream_overrides o))::date
$$;
create or replace function public.effective_previous_date(p_before date)
returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  select greatest((select max(b.date) from public.track_daily_streams b where b.date < p_before),
                  (select max(o.date) from public.track_daily_stream_overrides o where o.date < p_before))::date
$$;
create or replace function competitor.effective_latest_date()
returns date
language sql stable security definer
set search_path = competitor, pg_temp
as $$
  select greatest((select max(b.date) from competitor.track_daily_streams b),
                  (select max(o.date) from competitor.track_daily_stream_overrides o))::date
$$;
create or replace function competitor.effective_previous_date(p_before date)
returns date
language sql stable security definer
set search_path = competitor, pg_temp
as $$
  select greatest((select max(b.date) from competitor.track_daily_streams b where b.date < p_before),
                  (select max(o.date) from competitor.track_daily_stream_overrides o where o.date < p_before))::date
$$;
grant execute on function public.effective_latest_date() to anon, authenticated, service_role;
grant execute on function public.effective_previous_date(date) to anon, authenticated, service_role;
grant execute on function competitor.effective_latest_date() to anon, authenticated, service_role;
grant execute on function competitor.effective_previous_date(date) to anon, authenticated, service_role;

do $$
declare
  r record;
  def text;
  newdef text;
  step text;
begin
  for r in
    select * from (values
      ('public.network_selection_scoped_track_totals(text[],text,boolean)'::text, 'public'::text),
      ('competitor.network_selection_scoped_track_totals(text[],text,boolean)', 'competitor')
    ) as v(sig, sch)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    newdef := regexp_replace(def,
      'SELECT max\(date\)::date AS d FROM ' || r.sch || '\.track_daily_streams_effective_hot',
      'SELECT ' || r.sch || '.effective_latest_date() AS d');
    if newdef = def then
      raise exception 'latest-date rewrite: latest not found in %', r.sig;
    end if;
    step := newdef;
    newdef := regexp_replace(newdef,
      'SELECT max\(t\.date\)::date AS d\s+FROM ' || r.sch || '\.track_daily_streams_effective_hot t\s+WHERE t\.date < \(SELECT d FROM latest\)',
      'SELECT ' || r.sch || '.effective_previous_date((SELECT d FROM latest)) AS d');
    if newdef = step then
      raise exception 'latest-date rewrite: previous not found in %', r.sig;
    end if;
    execute newdef;
  end loop;
end
$$;
