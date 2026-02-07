-- Idempotent: creates the helper used to add new monthly partitions for track_daily_streams.
-- Run this in any environment that uses partitioned track_daily_streams.
-- The actual partition migration (creating the partitioned table) was applied separately.

CREATE OR REPLACE FUNCTION public.ensure_track_daily_streams_partitions(months_ahead integer DEFAULT 6)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  m date;
  partition_name text;
  start_date date;
  end_date date;
BEGIN
  FOR i IN 0..months_ahead LOOP
    m := date_trunc('month', CURRENT_DATE + (i || ' months')::interval)::date;
    partition_name := 'track_daily_streams_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM');
    start_date := m;
    end_date := m + '1 month'::interval;

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF track_daily_streams FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        start_date,
        end_date
      );
    END IF;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.ensure_track_daily_streams_partitions(integer) IS
  'Creates any missing monthly partitions for track_daily_streams for the current month and the next months_ahead months. Run periodically (e.g. monthly) so ETL can insert into future months.';
