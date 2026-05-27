-- Security hardening: remove direct public API access to raw own-catalog
-- analytics tables while preserving the read-only Ledgenta integration views.
--
-- This intentionally does not convert the *_public views to security_invoker.
-- Ledgenta reads those views with the StreamBase anon key; changing their
-- security mode would require a replacement integration contract first.

-- ---------------------------------------------------------------------------
-- 1) Keep Ledgenta-facing public views read-only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.track_daily_streams_effective_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.tracks_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.playlist_memberships_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.playlists_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.playlist_daily_stats_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.playlists_with_latest_stats_public FROM anon, authenticated;
REVOKE ALL ON TABLE public.collector_daily_agg_public FROM anon, authenticated;

GRANT SELECT ON TABLE public.track_daily_streams_effective_public TO anon, authenticated;
GRANT SELECT ON TABLE public.tracks_public TO anon, authenticated;
GRANT SELECT ON TABLE public.playlist_memberships_public TO anon, authenticated;
GRANT SELECT ON TABLE public.playlists_public TO anon, authenticated;
GRANT SELECT ON TABLE public.playlist_daily_stats_public TO anon, authenticated;
GRANT SELECT ON TABLE public.playlists_with_latest_stats_public TO anon, authenticated;
GRANT SELECT ON TABLE public.collector_daily_agg_public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Remove raw-table grants that were only needed before the *_public views.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.tracks FROM anon;
REVOKE ALL ON TABLE public.playlists FROM anon;
REVOKE ALL ON TABLE public.playlist_memberships FROM anon;
REVOKE ALL ON TABLE public.playlist_daily_stats FROM anon;

-- ---------------------------------------------------------------------------
-- 3) Harden raw own-catalog analytics and ops tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.track_daily_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_daily_stream_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isrc_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_warning_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_unplayable_track_exclusions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.track_daily_streams FROM anon, authenticated;
REVOKE ALL ON TABLE public.artist_daily_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.track_daily_stream_overrides FROM anon, authenticated;
REVOKE ALL ON TABLE public.isrc_aliases FROM anon, authenticated;
REVOKE ALL ON TABLE public.health_warning_exclusions FROM anon, authenticated;
REVOKE ALL ON TABLE public.health_unplayable_track_exclusions FROM anon, authenticated;

DO $$
DECLARE
  partition_regclass regclass;
BEGIN
  FOR partition_regclass IN
    SELECT inhrelid::regclass
    FROM pg_inherits
    WHERE inhparent = 'public.track_daily_streams'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', partition_regclass);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', partition_regclass);
  END LOOP;
END $$;

-- Operational tables may still be managed by authenticated admins if code ever
-- uses a request-scoped Supabase client. Server-side service-role code bypasses
-- RLS and is unaffected.
DROP POLICY IF EXISTS "Admins manage health_warning_exclusions" ON public.health_warning_exclusions;
CREATE POLICY "Admins manage health_warning_exclusions"
  ON public.health_warning_exclusions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage health_unplayable_track_exclusions" ON public.health_unplayable_track_exclusions;
CREATE POLICY "Admins manage health_unplayable_track_exclusions"
  ON public.health_unplayable_track_exclusions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage track_daily_stream_overrides" ON public.track_daily_stream_overrides;
CREATE POLICY "Admins manage track_daily_stream_overrides"
  ON public.track_daily_stream_overrides
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage isrc_aliases" ON public.isrc_aliases;
CREATE POLICY "Admins manage isrc_aliases"
  ON public.isrc_aliases
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4) Keep future monthly partitions hardened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_track_daily_streams_partitions(months_ahead integer DEFAULT 6)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  m date;
  partition_name text;
  start_date date;
  end_date date;
  partition_regclass regclass;
BEGIN
  FOR i IN 0..months_ahead LOOP
    m := date_trunc('month', CURRENT_DATE + (i || ' months')::interval)::date;
    partition_name := 'track_daily_streams_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM');
    start_date := m;
    end_date := m + '1 month'::interval;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE relname = partition_name
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF public.track_daily_streams FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        start_date,
        end_date
      );
    END IF;

    partition_regclass := format('public.%I', partition_name)::regclass;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', partition_regclass);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', partition_regclass);
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.ensure_track_daily_streams_partitions(integer) IS
  'Creates missing monthly partitions for track_daily_streams and hardens them with RLS plus no anon/authenticated direct table grants.';
