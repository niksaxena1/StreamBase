-- Owner decision 2026-10-12: keep only the current month + the previous full month as daily tables.
-- On the 1st of month M the job now packs month M-2 (was M-4). July and August 2026 were packed by hand
-- the same day and verified identical (847,013 rows, EXCEPT ALL both ways = 0).
create or replace function ops.pack_aged_stream_months()
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_target date := (date_trunc('month', current_date) - interval '2 months')::date;
  v_month date;
  v_universe text;
  v_hot date;
  v_rows bigint;
begin
  foreach v_universe in array array['own', 'competitor'] loop
    begin
      if v_universe = 'own' then
        v_hot := public.stream_history_hot_from();
      else
        v_hot := competitor.stream_history_hot_from();
      end if;

      -- first run on a fresh install: start at the first month that has daily data
      if v_hot < date '2020-01-01' then
        if v_universe = 'own' then
          select date_trunc('month', min(t.date))::date into v_hot from public.track_daily_streams t;
        else
          select date_trunc('month', min(t.date))::date into v_hot from competitor.track_daily_streams t;
        end if;
      end if;

      v_month := v_hot;
      while v_month is not null and v_month <= v_target loop
        if v_universe = 'own' then
          v_rows := public.pack_stream_month(v_month);
        else
          v_rows := competitor.pack_stream_month(v_month);
        end if;
        if v_rows is null or v_rows = 0 then
          raise exception 'no daily rows found for month %', v_month;
        end if;
        perform ops.raise_alert(
          v_universe, current_date,
          'partition_ready_to_remove_' || to_char(v_month, 'YYYY_MM'),
          'StreamBase: ' || v_universe || ' partition y' || to_char(v_month, 'YYYY') || 'm' || to_char(v_month, 'MM') || ' ready to remove',
          'Month ' || to_char(v_month, 'YYYY-MM') || ' was packed into ' ||
            case when v_universe = 'own' then 'public' else 'competitor' end ||
            '.track_streams_monthly (' || v_rows || ' ISRC rows). After running the checks in the newest ' ||
            'supabase/manual/*_remove_packed_partitions.sql, the daily partition track_daily_streams_y' ||
            to_char(v_month, 'YYYY') || 'm' || to_char(v_month, 'MM') || ' can be detached and removed to free space.');
        v_month := (v_month + interval '1 month')::date;
      end loop;
    exception when others then
      perform ops.raise_alert(
        v_universe, current_date, 'pack_stream_month_failed',
        'StreamBase: packing ' || v_universe || ' stream history failed',
        'ops.pack_aged_stream_months failed for ' || v_universe || ' at month ' || coalesce(v_month::text, '?') ||
          ': ' || sqlerrm || '. The daily partitions are untouched and readers keep working; fix the cause and ' ||
          'rerun select ops.pack_aged_stream_months().');
    end;
  end loop;
end;
$$;

