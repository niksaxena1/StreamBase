import type { OverlapArtistCell, OverlapCell, PlaylistRow } from "@/app/(main-flat)/competitors/competitorsTypes";
import {
  buildStatsByDataDate,
  enrichChurnRows,
  type AnchoredStatRow,
} from "@/app/(main-flat)/competitors/competitorsUtils";
import { CACHE_TTL_1H } from "@/lib/constants";
import {
  OWN_CATALOG_LABEL_KEY,
  OWN_CATALOG_PLAYLIST_KEY,
  parseOwnOverlapCells,
} from "@/lib/competitors/ownCatalog";
import { logDebug } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { dataDateFromRunDate, runDateFromDataDate } from "@/lib/sotDates";

import { parseChurnRows, parseMovers, type CompetitorsIntelPayload } from "./parseCompetitorsIntel";

function parseCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function augmentMoversWithOwnCatalog(
  movers: ReturnType<typeof parseMovers>,
  ownIsrcs: Set<string>,
): ReturnType<typeof parseMovers> {
  if (ownIsrcs.size === 0) return movers;
  return movers.map((row) => {
    if (!ownIsrcs.has(row.isrc) || row.label_keys.includes(OWN_CATALOG_LABEL_KEY)) {
      return row;
    }
    return { ...row, label_keys: [...row.label_keys, OWN_CATALOG_LABEL_KEY] };
  });
}

function ownChurnFromResult(
  ownChurnResult: { data: unknown; error: { message: string } | null },
): { label_key: string; added_count: number; removed_count: number; net: number } {
  if (ownChurnResult.error) {
    logDebug(`competitors-intel own churn skipped: ${ownChurnResult.error.message}`);
    return {
      label_key: OWN_CATALOG_LABEL_KEY,
      added_count: 0,
      removed_count: 0,
      net: 0,
    };
  }
  const ownChurnRaw = Array.isArray(ownChurnResult.data) ? ownChurnResult.data[0] : ownChurnResult.data;
  const ownChurnParsed = ownChurnRaw as Record<string, unknown> | null;
  return {
    label_key: OWN_CATALOG_LABEL_KEY,
    added_count: parseCount(ownChurnParsed?.added_count as number | string | null | undefined),
    removed_count: parseCount(ownChurnParsed?.removed_count as number | string | null | undefined),
    net: parseCount(ownChurnParsed?.net as number | string | null | undefined),
  };
}

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
  const svc = args.svc;
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
  const cacheKey = `competitors-intel-v4-resilient-${scope}-${latestRunDate}-churn${churnWindow}-${rollbackSuffix}`;

  const { data: bundle } = await cachedQuery(
    async () => {
      const [churnResult, ownChurnResult] = await Promise.all([
        comp.rpc("label_membership_churn", {
          p_window_days: churnWindow,
          p_as_of: latestRunDate,
        }),
        svc.rpc("catalog_membership_churn", {
          p_window_days: churnWindow,
          p_as_of: latestRunDate,
        }),
      ]);
      if (churnResult.error) return { data: null, error: churnResult.error };

      const ownChurnInput = ownChurnFromResult(ownChurnResult);

      const [
        gainersResult,
        losersResult,
        overlapResult,
        overlapArtistResult,
        ownOverlapResult,
        ownOverlapArtistResult,
        ownIsrcsResult,
        weekAgoStatsResult,
        anchoredForChurnResult,
        ownAnchoredForChurnResult,
        ownWeekAgoStatsResult,
      ] =
        scope === "churn"
          ? await Promise.all([
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
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
              weekAgoDataDate
                ? svc
                    .from("playlist_daily_stats")
                    .select(
                      "playlist_key,date,track_count,total_streams_cumulative,missing_streams_track_count,daily_streams_net",
                    )
                    .eq("playlist_key", OWN_CATALOG_PLAYLIST_KEY)
                    .in("date", [latestRunDate, weekAgoRunDate!].filter(Boolean))
                : Promise.resolve({ data: [] as AnchoredStatRow[], error: null }),
              weekAgoRunDate
                ? svc.rpc("playlist_daily_stats_as_of", { p_as_of_date: weekAgoRunDate })
                : Promise.resolve({ data: [], error: null }),
            ])
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
              comp.rpc("label_overlap_artist_matrix", { p_as_of: latestRunDate }),
              comp.rpc("own_catalog_overlap_matrix", { p_as_of: latestRunDate }),
              comp.rpc("own_catalog_overlap_artist_matrix", { p_as_of: latestRunDate }),
              svc.rpc("catalog_active_isrcs", { p_as_of: latestRunDate }),
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
              weekAgoDataDate
                ? svc
                    .from("playlist_daily_stats")
                    .select(
                      "playlist_key,date,track_count,total_streams_cumulative,missing_streams_track_count,daily_streams_net",
                    )
                    .eq("playlist_key", OWN_CATALOG_PLAYLIST_KEY)
                    .in("date", [latestRunDate, weekAgoRunDate!].filter(Boolean))
                : Promise.resolve({ data: [] as AnchoredStatRow[], error: null }),
              weekAgoRunDate
                ? svc.rpc("playlist_daily_stats_as_of", { p_as_of_date: weekAgoRunDate })
                : Promise.resolve({ data: [], error: null }),
            ]);

      if (scope === "full") {
        if (gainersResult.error) return { data: null, error: gainersResult.error };
        if (losersResult.error) return { data: null, error: losersResult.error };
        if (overlapResult.error) {
          logDebug(`competitors-intel overlap tracks skipped: ${overlapResult.error.message}`);
        }
        if (overlapArtistResult.error) {
          logDebug(`competitors-intel overlap artists skipped: ${overlapArtistResult.error.message}`);
        }
        if (ownOverlapResult.error) {
          logDebug(`competitors-intel own overlap tracks skipped: ${ownOverlapResult.error.message}`);
        }
        if (ownOverlapArtistResult.error) {
          logDebug(`competitors-intel own overlap artists skipped: ${ownOverlapArtistResult.error.message}`);
        }
        if (ownIsrcsResult.error) {
          logDebug(`competitors-intel catalog_active_isrcs skipped: ${ownIsrcsResult.error.message}`);
        }
      }

      const statsByDataDate = buildStatsByDataDate((anchoredForChurnResult.data ?? []) as AnchoredStatRow[]);

      for (const row of (ownAnchoredForChurnResult.data ?? []) as AnchoredStatRow[]) {
        const dataDate = dataDateFromRunDate(row.date.slice(0, 10));
        const byPlaylist = statsByDataDate.get(dataDate) ?? new Map();
        byPlaylist.set(row.playlist_key, {
          date: dataDate,
          track_count: row.track_count,
          total_streams_cumulative: row.total_streams_cumulative,
          missing_streams_track_count: row.missing_streams_track_count,
          daily_streams_net: row.daily_streams_net,
        });
        statsByDataDate.set(dataDate, byPlaylist);
      }

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
        const ownWeekAgoRow = ((ownWeekAgoStatsResult.data ?? []) as AnchoredStatRow[]).find(
          (r) => r.playlist_key === OWN_CATALOG_PLAYLIST_KEY,
        );
        if (ownWeekAgoRow && !byPlaylist.has(OWN_CATALOG_PLAYLIST_KEY)) {
          const rowDataDate = dataDateFromRunDate(ownWeekAgoRow.date.slice(0, 10));
          if (rowDataDate === weekAgoDataDate) {
            byPlaylist.set(OWN_CATALOG_PLAYLIST_KEY, {
              date: weekAgoDataDate,
              track_count: ownWeekAgoRow.track_count,
              total_streams_cumulative: ownWeekAgoRow.total_streams_cumulative,
              missing_streams_track_count: ownWeekAgoRow.missing_streams_track_count,
              daily_streams_net: ownWeekAgoRow.daily_streams_net,
            });
          }
        }
        statsByDataDate.set(weekAgoDataDate, byPlaylist);
      }

      const churn = enrichChurnRows(
        [ownChurnInput, ...parseChurnRows(churnResult.data)],
        playlistsByLabel,
        statsByDataDate,
        latestDataDate,
        weekAgoDataDate,
      );

      const ownIsrcs = ownIsrcsResult.error
        ? new Set<string>()
        : new Set(
            ((ownIsrcsResult.data ?? []) as Array<{ isrc?: string }>)
              .map((r) => String(r.isrc ?? "").trim())
              .filter(Boolean),
          );

      return {
        data: {
          gainers: augmentMoversWithOwnCatalog(parseMovers(gainersResult.data), ownIsrcs),
          losers: augmentMoversWithOwnCatalog(parseMovers(losersResult.data), ownIsrcs),
          churn,
          overlapCells: overlapResult.error ? [] : ((overlapResult.data ?? []) as OverlapCell[]),
          overlapArtistCells: overlapArtistResult.error
            ? []
            : ((overlapArtistResult.data ?? []) as OverlapArtistCell[]),
          ownOverlapCells: ownOverlapResult.error ? [] : parseOwnOverlapCells(ownOverlapResult.data),
          ownOverlapArtistCells: ownOverlapArtistResult.error
            ? []
            : parseOwnOverlapCells(ownOverlapArtistResult.data),
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
      overlapArtistCells: [],
      ownOverlapCells: [],
      ownOverlapArtistCells: [],
    }
  );
}
