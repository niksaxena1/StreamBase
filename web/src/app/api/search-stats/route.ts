import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_5MIN, CACHE_TTL_24H } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";
import { resolveCompetitorLabelKey } from "@/lib/competitorContext";
import type { CompetitorLabelScope } from "@/lib/competitorLabelScope.server";
import {
  loadCompetitorLabelScope,
  loadCompetitorTracksForArtist,
  sumCompetitorStreamsForIsrcs,
} from "@/lib/competitorLabelScope.server";
import { isInCompetitorScope } from "@/lib/competitorLabelScope";
import { normalizeDatasetMode } from "@/lib/datasetMode";

export const dynamic = "force-dynamic";

type SearchStatsDbClient = Pick<SupabaseClient, "from" | "rpc">;

async function resolveLatestRunDate(
  client: SearchStatsDbClient,
  datasetMode: "own" | "competitor",
): Promise<string | null> {
  const cacheSuffix = datasetMode;
  const { data: latestRun } = await cachedQuery(
    async () => {
      if (datasetMode === "competitor") {
        const { data: fromRuns } = await client
          .from("ingestion_runs")
          .select("run_date")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fromRuns?.run_date) return { data: fromRuns, error: null };

        const { data: fromStats } = await client
          .from("playlist_daily_stats")
          .select("date")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { data: fromStats ? { run_date: fromStats.date } : null, error: null };
      }

      return await client
        .from("playlist_daily_stats")
        .select("date")
        .eq("playlist_key", "all_catalog")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((r) => ({ data: r.data ? { run_date: r.data.date } : null, error: r.error }));
    },
    `search-stats-latest-run-date-${cacheSuffix}`,
    CACHE_TTL_5MIN,
  );

  const row = latestRun as { run_date?: string; date?: string } | null;
  return row?.run_date ?? row?.date ?? null;
}

async function fetchSearchStats(args: {
  datasetMode: "own" | "competitor";
  dataClient: SearchStatsDbClient;
  latestRunDate: string | null;
  type: string;
  id: string;
  competitorScope: CompetitorLabelScope | null;
}): Promise<{ type: string; streams: number } | null> {
  const { datasetMode, dataClient, latestRunDate, type, id, competitorScope } = args;

  if (type === "track") {
    if (datasetMode === "competitor") {
      if (!isInCompetitorScope(id, competitorScope?.scopedIsrcs)) {
        return { type: "track", streams: 0 };
      }
      const q = dataClient.from("track_daily_streams").select("streams_cumulative");
      const { data: trackStats } = latestRunDate
        ? await q.eq("date", latestRunDate).eq("isrc", id).maybeSingle()
        : await q.eq("isrc", id).order("date", { ascending: false }).limit(1).maybeSingle();
      return {
        type: "track",
        streams: Number((trackStats as { streams_cumulative?: number } | null)?.streams_cumulative ?? 0),
      };
    }

    const q = dataClient.from("track_daily_streams_effective_public").select("streams_cumulative");
    const { data: trackStats } = latestRunDate
      ? await q.eq("date", latestRunDate).eq("isrc", id).maybeSingle()
      : await q.eq("isrc", id).order("date", { ascending: false }).limit(1).maybeSingle();
    return {
      type: "track",
      streams: Number((trackStats as { streams_cumulative?: number } | null)?.streams_cumulative ?? 0),
    };
  }

  if (!latestRunDate) {
    return { type, streams: 0 };
  }

  if (type === "artist") {
    if (datasetMode === "competitor") {
      const trackRows = await loadCompetitorTracksForArtist(
        dataClient,
        id,
        competitorScope?.scopedIsrcs ?? null,
      );
      const isrcs = trackRows.map((r) => r.isrc).filter(Boolean);
      if (!isrcs.length) return { type: "artist", streams: 0 };
      const total = await sumCompetitorStreamsForIsrcs(dataClient, {
        isrcs,
        latestRunDate,
      });
      return { type: "artist", streams: total };
    }

    const { data: totalStreams, error } = await dataClient.rpc("artist_total_streams_for_date", {
      artist_id: id,
      run_date: latestRunDate,
    });
    if (error) return { type: "artist", streams: 0 };
    return { type: "artist", streams: Number(totalStreams ?? 0) };
  }

  if (type === "playlist") {
    if (datasetMode === "competitor") {
      if (!isInCompetitorScope(id, competitorScope?.playlistKeys)) {
        return { type: "playlist", streams: 0 };
      }
      const { data: row } = await dataClient
        .from("playlist_daily_stats")
        .select("total_streams_cumulative")
        .eq("playlist_key", id)
        .eq("date", latestRunDate)
        .maybeSingle();
      return {
        type: "playlist",
        streams: Number((row as { total_streams_cumulative?: number } | null)?.total_streams_cumulative ?? 0),
      };
    }

    const { data: totalStreams, error } = await dataClient.rpc("playlist_total_streams_for_date", {
      playlist_key: id,
      run_date: latestRunDate,
    });
    if (error) return { type: "playlist", streams: 0 };
    return { type: "playlist", streams: Number(totalStreams ?? 0) };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const sb = await supabaseServer();
    const auth = await requireUser(sb);
    if (!auth.ok) return auth.response;

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const id = searchParams.get("id");

    if (!type || !id) {
      return apiJsonErr("Missing type or id", 400);
    }

    const svc = supabaseService();
    const { data: settings } = await svc
      .from("user_settings")
      .select("dataset_mode,competitor_label_key")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
    let competitorLabelKey =
      typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
        ? settings.competitor_label_key.trim()
        : null;
    if (datasetMode === "competitor" && !competitorLabelKey) {
      const { data: labels } = await svc
        .schema("competitor")
        .from("labels")
        .select("label_key,display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      competitorLabelKey = resolveCompetitorLabelKey(
        null,
        (labels ?? []) as Array<{ label_key: string; display_name: string }>,
      );
    }
    const dataClient: SearchStatsDbClient =
      datasetMode === "competitor" ? svc.schema("competitor") : sb;
    const latestClient: SearchStatsDbClient =
      datasetMode === "competitor" ? svc.schema("competitor") : svc;

    const latestRunDate = await resolveLatestRunDate(latestClient, datasetMode);
    const labelScope = datasetMode === "competitor" ? (competitorLabelKey ?? "none") : "own";
    const cacheKey = `search-stats-v4-${datasetMode}-${labelScope}-${type}-${id}-${latestRunDate ?? "none"}`;

    const competitorScope =
      datasetMode === "competitor"
        ? await loadCompetitorLabelScope(dataClient, {
            labelKey: competitorLabelKey,
            latestRunDate,
          })
        : null;

    const { data: payload } = await cachedQuery(
      async () => {
        const stats = await fetchSearchStats({
          datasetMode,
          dataClient,
          latestRunDate,
          type,
          id,
          competitorScope,
        });
        if (!stats) return { data: null, error: new Error("Invalid type") };
        return { data: stats, error: null };
      },
      cacheKey,
      CACHE_TTL_24H,
    );

    if (payload) return apiJsonOk(payload);

    return apiJsonErr("Invalid type", 400);
  } catch (error) {
    logError("Search stats error", error);
    return apiJsonErr("Failed to fetch stats", 500);
  }
}
