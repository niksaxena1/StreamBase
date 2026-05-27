import type { OverlapCell, PlaylistRow } from "@/app/(main-flat)/competitors/competitorsTypes";
import {
  buildStatsByDataDate,
  enrichChurnRows,
  sumLabelAtDataDate,
  type AnchoredStatRow,
} from "@/app/(main-flat)/competitors/competitorsUtils";
import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { addDaysISO, dataDateFromRunDate, runDateFromDataDate } from "@/lib/sotDates";

import { parseChurnRows, parseMovers, type CompetitorsIntelPayload } from "./parseCompetitorsIntel";

export async function loadCompetitorsIntel(args: {
  svc: ReturnType<typeof import("@/lib/supabase/service").supabaseService>;
  latestRunDate: string;
  latestDataDate: string;
  weekAgoDataDate: string | null;
  playlistKeys: string[];
  playlistsByLabel: Map<string, PlaylistRow[]>;
  churnWindow: 7 | 30;
  rollbackSuffix: string;
  scope?: "full" | "churn";
}): Promise<CompetitorsIntelPayload> {
  const comp = args.svc.schema("competitor");
  const {
    latestRunDate,
    latestDataDate,
    weekAgoDataDate,
    playlistKeys,
    playlistsByLabel,
    churnWindow,
    rollbackSuffix,
    scope = "full",
  } = args;

  const weekAgoRunDate = weekAgoDataDate ? runDateFromDataDate(weekAgoDataDate) : null;
  const cacheKey = `competitors-intel-${scope}-${latestRunDate}-churn${churnWindow}-${rollbackSuffix}`;

  const { data: bundle } = await cachedQuery(
    async () => {
      const churnResult = await comp.rpc("label_membership_churn", {
        p_window_days: churnWindow,
        p_as_of: latestRunDate,
      });
      if (churnResult.error) return { data: null, error: churnResult.error };

      const [gainersResult, losersResult, overlapResult, weekAgoStatsResult, anchoredForChurnResult] =
        scope === "churn"
          ? [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [] as AnchoredStatRow[], error: null },
            ]
          : await Promise.all([
              comp.rpc("label_top_tracks_daily", {
                p_run_date: latestRunDate,
                p_limit: 15,
                p_direction: "gainers",
              }),
              comp.rpc("label_top_tracks_daily", {
                p_run_date: latestRunDate,
                p_limit: 15,
                p_direction: "losers",
              }),
              comp.rpc("label_overlap_matrix", { p_as_of: latestRunDate }),
              weekAgoRunDate
                ? comp.rpc("playlist_daily_stats_as_of", { p_as_of_date: weekAgoRunDate })
                : Promise.resolve({ data: [], error: null }),
              weekAgoDataDate && playlistKeys.length > 0
                ? comp
                    .from("playlist_daily_stats")
                    .select(
                      "playlist_key,date,track_count,total_streams_cumulative,missing_streams_track_count,daily_streams_net",
                    )
                    .eq("date", weekAgoRunDate!)
                    .in("playlist_key", playlistKeys)
                : Promise.resolve({ data: [] as AnchoredStatRow[], error: null }),
            ]);

      if (scope === "full") {
        if (gainersResult.error) return { data: null, error: gainersResult.error };
        if (losersResult.error) return { data: null, error: losersResult.error };
        if (overlapResult.error) return { data: null, error: overlapResult.error };
      }

      const statsByDataDate = buildStatsByDataDate((anchoredForChurnResult.data ?? []) as AnchoredStatRow[]);

      if (weekAgoDataDate) {
        const byPlaylist = statsByDataDate.get(weekAgoDataDate) ?? new Map();
        for (const row of (weekAgoStatsResult.data ?? []) as AnchoredStatRow[]) {
          if (byPlaylist.has(row.playlist_key)) continue;
          const rowDataDate = dataDateFromRunDate(row.date.slice(0, 10));
          if (rowDataDate !== weekAgoDataDate) continue;
          byPlaylist.set(row.playlist_key, {
            date: weekAgoDataDate,
            track_count: row.track_count,
            total_streams_cumulative: row.total_streams_cumulative,
            missing_streams_track_count: row.missing_streams_track_count,
            daily_streams_net: row.daily_streams_net,
          });
        }
        statsByDataDate.set(weekAgoDataDate, byPlaylist);
      }

      const churn = enrichChurnRows(
        parseChurnRows(churnResult.data),
        playlistsByLabel,
        statsByDataDate,
        latestDataDate,
        weekAgoDataDate,
      );

      return {
        data: {
          gainers: parseMovers(gainersResult.data),
          losers: parseMovers(losersResult.data),
          churn,
          overlapCells: (overlapResult.data ?? []) as OverlapCell[],
        },
        error: null,
      };
    },
    cacheKey,
    CACHE_TTL_1H,
  );

  return (
    bundle ?? {
      gainers: [],
      losers: [],
      churn: [],
      overlapCells: [],
    }
  );
}
