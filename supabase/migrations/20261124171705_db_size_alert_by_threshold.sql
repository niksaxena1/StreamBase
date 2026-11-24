-- The size warning was meant to repeat weekly but its dedupe key included the day, so it mailed daily.
-- Now it mails once per threshold crossed (450 / 470 / 485 / 495 MB) per calendar month.
create or replace function ops.check_db_size()
 returns void
 language plpgsql
 security definer
 set search_path to 'ops', 'pg_temp'
as $function$
declare
  v_bytes bigint := pg_database_size(current_database());
  v_mb numeric := v_bytes / (1024.0 * 1024.0);
  v_band integer;
begin
  v_band := case when v_mb > 495 then 495 when v_mb > 485 then 485
                 when v_mb > 470 then 470 when v_mb > 450 then 450 end;
  if v_band is not null then
    perform ops.raise_alert('all', date_trunc('month', current_date)::date, 'db_size_over_' || v_band,
      '[StreamBase] Database is ' || pg_size_pretty(v_bytes) || ' (passed ' || v_band || ' MB; Free plan limit 500 MB)',
      'The StreamBase database passed the ' || v_band || ' MB line. Above 500 MB Supabase can make it read-only. '
        || 'Biggest tables: run select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class order by 2 desc; '
        || 'and see docs/COMPACT-STREAM-STORAGE.md for the levers (daily window, compact/R2 archive tiers). '
        || 'You get one email per line passed (450, 470, 485, 495 MB) per calendar month, not a daily reminder.');
    perform ops.flush_alerts();
  end if;
end;
$function$;
