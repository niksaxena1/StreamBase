-- Persist the preferred "week highlight day" used by time-series charts.
-- Stored as integer day-of-week index in UTC, matching JS Date#getUTCDay():
-- 0=Sunday, 1=Monday, ..., 6=Saturday

alter table if exists user_settings
  add column if not exists chart_week_highlight_day smallint not null default 0;

-- Defensive constraint (if supported in the environment).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_chart_week_highlight_day_range'
  ) then
    alter table user_settings
      add constraint user_settings_chart_week_highlight_day_range
      check (chart_week_highlight_day between 0 and 6);
  end if;
end $$;

