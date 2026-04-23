-- Grant anon read for Ledgenta dashboard catalog-wide SpotiBase comparison.
-- playlist_daily_stats holds pre-aggregated all_catalog daily cumulative streams.

GRANT SELECT ON public.playlist_daily_stats TO anon;

-- RLS is enabled on this table; add a permissive read policy for anon.
-- (DROP + CREATE instead of IF NOT EXISTS which CREATE POLICY doesn't support.)
DROP POLICY IF EXISTS "anon_read_playlist_daily_stats" ON public.playlist_daily_stats;
CREATE POLICY "anon_read_playlist_daily_stats"
  ON public.playlist_daily_stats
  FOR SELECT TO anon
  USING (true);
