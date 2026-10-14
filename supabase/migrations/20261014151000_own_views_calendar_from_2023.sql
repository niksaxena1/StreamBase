-- Own-catalog effective/base views: the compact calendar join started at 2025-01-01, which would hide the
-- recovered 2023-07..2024-12 compact months. Start it at 2023-01-01 (series long enough to ~2036).
-- Done by rewriting the live view definitions in place (grants/options preserved by create or replace).
do $$
declare
  v text;
  def text;
begin
  foreach v in array array['public.track_daily_streams_base_all', 'public.track_daily_streams_effective'] loop
    def := pg_get_viewdef(v::regclass, true);
    if def not like '%''2025-01-01''::date%' then
      raise exception 'calendar anchor not found in %', v;
    end if;
    def := replace(def, '''2025-01-01''::date', '''2023-01-01''::date');
    def := replace(def, 'generate_series(0, 4017)', 'generate_series(0, 5000)');
    execute format('create or replace view %s as %s', v, def);
  end loop;
end $$;
notify pgrst, 'reload schema';
