-- Compute catalog artist series on demand and retire artist_daily_stats.
--
-- Goal: make public.artist_daily_stats and competitor.artist_daily_stats (~272 MB
-- together; the project is over the 500 MB Free-plan quota) unnecessary so the
-- owner can drop them.
--
-- * catalog_artist_series_fast (both schemas) no longer reads artist_daily_stats.
--   It sums the per-ISRC effective stream value (override if a row exists for
--   (date, isrc), else track_daily_streams) for the artist's ISRCs. Override-only
--   (date, isrc) rows with no base row are included, exactly like the
--   track_daily_streams_effective(_public) views. The old summary-table path was
--   also stale for dates whose overrides changed after the last refresh; the
--   on-demand result always reflects live data.
-- * The function is plpgsql + EXECUTE ... USING on purpose. A LANGUAGE sql body is
--   planned once with unknown parameters (generic plan), which picked slow plans
--   (seconds) for large artists. EXECUTE plans with the real artist/date values:
--   ANY(array) over the (isrc, date) index, partition pruning on the date range,
--   and a hash full join against the artist's (few) override rows.
-- * refresh_artist_daily_stats (both schemas) becomes a cheap no-op that keeps its
--   signature, return type (integer), SECURITY DEFINER, search_path and grants, so
--   scripts/ingest_*_exports_to_supabase.py and
--   public.spotibase_recompute_playlist_daily_stats_cascade keep working.
-- * CREATE OR REPLACE keeps the existing ACLs (no GRANT/REVOKE here).

-- ---------------------------------------------------------------------------
-- public.catalog_artist_series_fast
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_artist_series_fast(
  artist_id text,
  start_date date,
  end_date date
)
RETURNS TABLE(date date, streams_cumulative bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH artist_isrcs AS (
      SELECT array_agg(t.isrc) AS arr
      FROM public.tracks t
      WHERE t.spotify_artist_ids @> ARRAY[$1]::text[]
    ),
    base AS (
      SELECT b.date, b.isrc, b.streams_cumulative
      FROM public.track_daily_streams b
      CROSS JOIN artist_isrcs a
      WHERE b.isrc = ANY (a.arr)
        AND b.date BETWEEN $2 AND $3
    ),
    ov AS (
      SELECT o.date, o.isrc, o.streams_cumulative_override AS v
      FROM public.track_daily_stream_overrides o
      CROSS JOIN artist_isrcs a
      WHERE o.isrc = ANY (a.arr)
        AND o.date BETWEEN $2 AND $3
    )
    SELECT
      COALESCE(b.date, o.date)::date AS date,
      SUM(COALESCE(o.v, b.streams_cumulative, 0))::bigint AS streams_cumulative
    FROM base b
    FULL JOIN ov o ON o.date = b.date AND o.isrc = b.isrc
    GROUP BY 1
    ORDER BY 1
  $q$ USING artist_id, start_date, end_date;
END;
$function$;

COMMENT ON FUNCTION public.catalog_artist_series_fast(text, date, date)
IS 'Cumulative streams per date for an artist, computed on demand from track_daily_streams + track_daily_stream_overrides (same value as track_daily_streams_effective_public). No summary table.';

-- ---------------------------------------------------------------------------
-- competitor.catalog_artist_series_fast
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION competitor.catalog_artist_series_fast(
  artist_id text,
  start_date date,
  end_date date
)
RETURNS TABLE(date date, streams_cumulative bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH artist_isrcs AS (
      SELECT array_agg(t.isrc) AS arr
      FROM competitor.tracks t
      WHERE t.spotify_artist_ids @> ARRAY[$1]::text[]
    ),
    base AS (
      SELECT b.date, b.isrc, b.streams_cumulative
      FROM competitor.track_daily_streams b
      CROSS JOIN artist_isrcs a
      WHERE b.isrc = ANY (a.arr)
        AND b.date BETWEEN $2 AND $3
    ),
    ov AS (
      SELECT o.date, o.isrc, o.streams_cumulative_override AS v
      FROM competitor.track_daily_stream_overrides o
      CROSS JOIN artist_isrcs a
      WHERE o.isrc = ANY (a.arr)
        AND o.date BETWEEN $2 AND $3
    )
    SELECT
      COALESCE(b.date, o.date)::date AS date,
      SUM(COALESCE(o.v, b.streams_cumulative, 0))::bigint AS streams_cumulative
    FROM base b
    FULL JOIN ov o ON o.date = b.date AND o.isrc = b.isrc
    GROUP BY 1
    ORDER BY 1
  $q$ USING artist_id, start_date, end_date;
END;
$function$;

COMMENT ON FUNCTION competitor.catalog_artist_series_fast(text, date, date)
IS 'Cumulative streams per date for a competitor artist, computed on demand from competitor.track_daily_streams + competitor.track_daily_stream_overrides (same value as competitor.track_daily_streams_effective_public). No summary table.';

-- ---------------------------------------------------------------------------
-- refresh_artist_daily_stats: cheap no-ops (signature/return type/ACLs kept)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_artist_daily_stats(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- artist_daily_stats is no longer read or written; the artist series is computed
  -- on demand by public.catalog_artist_series_fast. Kept so ingestion and
  -- spotibase_recompute_playlist_daily_stats_cascade keep calling it.
  RETURN 0;
END;
$function$;

COMMENT ON FUNCTION public.refresh_artist_daily_stats(date, date)
IS 'No-op (returns 0). artist_daily_stats was retired; public.catalog_artist_series_fast computes the series on demand. Kept for call-site compatibility.';

CREATE OR REPLACE FUNCTION competitor.refresh_artist_daily_stats(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- See public.refresh_artist_daily_stats.
  RETURN 0;
END;
$function$;

COMMENT ON FUNCTION competitor.refresh_artist_daily_stats(date, date)
IS 'No-op (returns 0). competitor.artist_daily_stats was retired; competitor.catalog_artist_series_fast computes the series on demand. Kept for call-site compatibility.';

-- ---------------------------------------------------------------------------
-- OWNER ONLY: reclaim ~272 MB. Owner applies after one day of verification
-- (Catalog artist charts in own and Competitor mode, an ingestion run, and an
-- override cascade). Nothing above or in the app/scripts reads these tables.
-- Uncomment and run manually (or as a follow-up migration):
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.artist_daily_stats;
-- DROP TABLE IF EXISTS competitor.artist_daily_stats;
