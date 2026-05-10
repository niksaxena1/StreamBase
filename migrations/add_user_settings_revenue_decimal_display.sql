-- Persist the user's preferred revenue decimal display mode.

alter table if exists user_settings
  add column if not exists revenue_decimal_display text not null default 'normal';

do $$
begin
  if to_regclass('public.user_settings') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'user_settings_revenue_decimal_display_check'
    )
  then
    alter table public.user_settings
      add constraint user_settings_revenue_decimal_display_check
      check (revenue_decimal_display in ('normal', 'muted', 'hidden'));
  end if;
end $$;
