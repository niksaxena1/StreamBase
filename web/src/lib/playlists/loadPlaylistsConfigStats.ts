import { CACHE_TTL_1H } from "@/lib/constants";
import { addDaysISO } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";

import type { PlaylistsConfigStats } from "./loadPlaylistsConfigPage";

type StatRow = {
  playlist_key: string;
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
};

function buildStatsMap(rows: StatRow[], latestDate: string, prevDate: string): Record<string, PlaylistsConfigStats> {
  const byKey = new Map<string, { latest?: StatRow; prev?: StatRow }>();

  for (const row of rows) {
    const key = String(row.playlist_key ?? "");
    if (!key) continue;
    const date = String(row.date ?? "").slice(0, 10);
    const bucket = byKey.get(key) ?? {};
    if (date === latestDate) bucket.latest = row;
    else if (date === prevDate) bucket.prev = row;
    byKey.set(key, bucket);
  }

  const statsMap: Record<string, PlaylistsConfigStats> = {};
  for (const [key, { latest, prev }] of byKey) {
    if (!latest) continue;
    const curTracks = latest.track_count ?? null;
    const prevTracks = prev ? (prev.track_count ?? null) : null;
    const dailyTracksNet =
      curTracks === null || prevTracks === null ? null : Number(curTracks) - Number(prevTracks);
    statsMap[key] = {
      track_count: latest.track_count ?? null,
      daily_tracks_net: dailyTracksNet,
      total_streams_cumulative: latest.total_streams_cumulative ?? null,
      daily_streams_net: latest.daily_streams_net ?? null,
    };
  }

  return statsMap;
}

export async function loadPlaylistsConfigStats(): Promise<{
  statsMap: Record<string, PlaylistsConfigStats>;
  errorMessage: string | null;
}> {
  const sb = await supabaseServer();

  const cached = await cachedQuery(
    async () => {
      const { data: latestRow, error: latestError } = await sb
        .from("playlist_daily_stats")
        .select("date")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) return { data: null, error: latestError };

      const latestDate = String((latestRow as { date?: string } | null)?.date ?? "").slice(0, 10);
      if (!latestDate) {
        return { data: { statsMap: {} }, error: null };
      }

      const prevDate = addDaysISO(latestDate, -1);
      const { data: statRows, error: statsError } = await sb
        .from("playlist_daily_stats")
        .select("playlist_key,date,track_count,total_streams_cumulative,daily_streams_net")
        .in("date", [latestDate, prevDate]);

      if (statsError) return { data: null, error: statsError };

      return {
        data: {
          statsMap: buildStatsMap((statRows ?? []) as StatRow[], latestDate, prevDate),
        },
        error: null,
      };
    },
    "playlists-config-stats",
    CACHE_TTL_1H,
  );

  return {
    statsMap: cached.data?.statsMap ?? {},
    errorMessage: cached.error?.message ?? null,
  };
}
