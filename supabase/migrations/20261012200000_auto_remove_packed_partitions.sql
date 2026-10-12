-- Automate the monthly "remove packed partition" step (owner request 2026-10-12).
-- OWNER PASTE (contains DROP, which the agent connector refuses). Run once in the SpotiBase SQL editor.
--
-- ops.remove_packed_partitions(p_dry_run):
--   for every daily partition of public/competitor.track_daily_streams whose month is older than that
--   universe's stream_history_hot_from() (i.e. the month is served from track_streams_monthly):
--     1. re-verify the compact copy is identical (row count + EXCEPT ALL both ways on date, isrc, streams)
--     2. identical  -> detach + drop the partition (skipped when p_dry_run)
--        different  -> keep it and raise a pipeline alert (emailed): the only case you hear about
-- Runs from pg_cron at 03:55 UTC on days 1-3, after the 03:40 packing job. Failures-only email policy:
-- successful removals send nothing, and packing no longer sends "ready to remove" emails.

create or replace function ops.remove_packed_partitions(p_dry_run boolean default false)
returns table (partition_name text, month date, action text)
language plpgsql
security definer
set search_path = ops, pg_temp
set lock_timeout = '10s'
as $$
declare
  v_schema text;
  v_hot date;
  r record;
  v_month date;
  v_part_rows bigint;
  v_packed_rows bigint;
  v_diff bigint;
begin
  foreach v_schema in array array['public', 'competitor'] loop
    execute format('select %I.stream_history_hot_from()', v_schema) into v_hot;

    for r in
      select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_namespace n on n.oid = c.relnamespace
      where i.inhparent = format('%I.track_daily_streams', v_schema)::regclass
        and n.nspname = v_schema
        and c.relname ~ '^track_daily_streams_y[0-9]{4}m[0-9]{2}$'
      order by c.relname
    loop
      v_month := to_date(substring(r.relname from 'y([0-9]{4})m') || '-' || substring(r.relname from 'm([0-9]{2})$') || '-01', 'YYYY-MM-DD');
      continue when v_month >= v_hot;

      partition_name := v_schema || '.' || r.relname;
      month := v_month;
      begin
        execute format('select count(*) from %I.%I', v_schema, r.relname) into v_part_rows;
        execute format(
          'select count(*) from %I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
           where m.month = $1 and u.v is not null', v_schema)
          using v_month into v_packed_rows;
        execute format(
          'select count(*) from (
             (select date, isrc, streams_cumulative from %1$I.%2$I
              except all
              select (m.month + (u.d - 1)::int), m.isrc, u.v
              from %1$I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
              where m.month = $1 and u.v is not null)
             union all
             (select (m.month + (u.d - 1)::int), m.isrc, u.v
              from %1$I.track_streams_monthly m cross join lateral unnest(m.vals) with ordinality as u(v, d)
              where m.month = $1 and u.v is not null
              except all
              select date, isrc, streams_cumulative from %1$I.%2$I)) x', v_schema, r.relname)
          using v_month into v_diff;

        if v_part_rows = 0 or v_part_rows <> v_packed_rows or v_diff <> 0 then
          action := format('kept: mismatch (partition %s rows, compact %s rows, %s differing)', v_part_rows, v_packed_rows, v_diff);
          perform ops.raise_alert(
            case when v_schema = 'public' then 'own' else 'competitor' end, current_date,
            'partition_remove_blocked_' || to_char(v_month, 'YYYY_MM'),
            '[StreamBase] Old daily partition kept: compact copy does not match (' || partition_name || ')',
            'ops.remove_packed_partitions did NOT remove ' || partition_name || ' because ' || action ||
            '. Nothing was lost: the daily partition is still there. Re-run public/competitor.pack_stream_month(''' ||
            v_month || ''') and then select ops.remove_packed_partitions();');
        elsif p_dry_run then
          action := format('would remove (%s rows verified identical)', v_part_rows);
        else
          execute format('alter table %1$I.track_daily_streams detach partition %1$I.%2$I', v_schema, r.relname);
          execute format('drop table %I.%I', v_schema, r.relname);
          action := format('removed (%s rows verified identical)', v_part_rows);
        end if;
      exception when others then
        action := 'kept: error ' || sqlerrm;
        perform ops.raise_alert(
          case when v_schema = 'public' then 'own' else 'competitor' end, current_date,
          'partition_remove_failed_' || to_char(v_month, 'YYYY_MM'),
          '[StreamBase] Removing old daily partition failed (' || partition_name || ')',
          'ops.remove_packed_partitions failed on ' || partition_name || ': ' || sqlerrm ||
          '. The partition is still there and readers keep working. Retry with select ops.remove_packed_partitions();');
      end;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function ops.remove_packed_partitions(boolean) from public, anon, authenticated;

-- Packing no longer emails "ready to remove" (removal is automatic now); it still emails on failure.
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

select cron.schedule('streambase-remove-packed-partitions', '55 3 1-3 * *', 'select ops.remove_packed_partitions()');

-- Check (should list the two cron jobs, and the dry run should return no rows today because every
-- partition older than September has already been removed):
select jobname, schedule from cron.job where jobname like 'streambase-%';
select * from ops.remove_packed_partitions(true);
