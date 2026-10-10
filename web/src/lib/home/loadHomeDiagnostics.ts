import type { HomeDashboardSearchParams, ArtistWeekendDipRow, TrackWeekendDipRow, NegativeDailyStreamsRow, ArtificialStreamSpikeRow, PlaylistDailyStatsRow } from "@/app/(main-flat)/home/homeTypes";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestAppContext } from "@/lib/requestAppContext.server";
import type { HomeDiagnosticsApiPayload } from "@/lib/home/homeDiagnosticsApi";
import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { timedServerStep } from "@/lib/serverTiming";
import { perfServerStep } from "@/lib/perfTiming.server";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { SOT_DATA_LAG_DAYS, addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { aggregateCompetitorPlaylistHistory } from "@/lib/competitorAnalytics";
import { resolveHomeDataset } from "@/lib/home/homeDataset.server";

export async function loadHomeDiagnosticsDataForUser(args: {
  sb: SupabaseClient;
  svc: RequestAppContext["svc"];
  userId: string;
  sp: HomeDashboardSearchParams;
  context?: Pick<RequestAppContext, "settings" | "shellContext">;
}): Promise<HomeDiagnosticsApiPayload> {
  return perfServerStep("loadHomeDiagnosticsDataForUser", async () => {
    const { sb, svc, userId, sp, context } = args;
    const settingsPromise = context ? Promise.resolve(context.settings) : (async () => {
      try {
        return (await sb.from("user_settings")
          .select("hide_stale_override_annotations, artificial_streams_spike_ratio, artificial_streams_include_weekends_user, dataset_mode, competitor_label_key")
          .eq("user_id", userId).maybeSingle()).data;
      } catch { return null; }
    })();
    const healthPromise = (async () => {
      try {
        return (await svc.from("health_config").select("key,value_numeric").in("key", [
          "artificial_streams_spike_ratio", "artificial_streams_min_baseline", "artificial_streams_new_track_grace_days",
          "artificial_streams_threshold_crossing_max", "artificial_streams_include_weekends",
        ])).data ?? [];
      } catch { return []; }
    })();
    const readVersion = async (competitor: boolean) => {
      try {
        const { data } = await (competitor
          ? svc.schema("competitor").rpc("spotibase_override_version")
          : svc.rpc("spotibase_override_version"));
        return typeof data === "string" && data ? data : "0";
      } catch { return "0"; }
    };
    const versionPromise = Promise.all([readVersion(false), readVersion(true)])
      .then(([own, comp]) => `own${own}-comp${comp}`);
    const rollbackPromise = getRollbackDate();
    const datasetPromise = settingsPromise.then((settings) => resolveHomeDataset({
      svc, settings, labels: context?.shellContext.competitorLabels, ignoreLabelErrors: true,
    }));
    const [settings, hcRows, overrideBuster, rollbackDate, { datasetMode, competitorLabelKey }] = await Promise.all([
      settingsPromise, healthPromise, versionPromise, rollbackPromise, datasetPromise,
    ]);
    const scope = (sp.scope ?? "all_catalog").toLowerCase();
    const playlistKey = scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";
    const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;
    // Use the same diagnostic-only history key and query as Home. No annotations,
    // images, entity history, or chart payloads are loaded or constructed here.
    const { data: history } = await cachedQuery<PlaylistDailyStatsRow[]>(async () => {
      if (datasetMode === "competitor" && competitorLabelKey) {
        const comp = svc.schema("competitor");
        let q = comp.from("playlists").select("playlist_key").eq("is_active", true);
        if (competitorLabelKey !== ALL_COMPETITORS_KEY) q = q.eq("label_key", competitorLabelKey);
        const { data: playlists } = await q;
        const keys = (playlists ?? []).map((p: { playlist_key: string }) => p.playlist_key).filter(Boolean);
        if (!keys.length) return { data: [], error: null };
        let stats = comp.from("playlist_daily_stats")
          .select("date,playlist_key,track_count,total_streams_cumulative,daily_streams_net,missing_streams_track_count")
          .in("playlist_key", keys);
        if (rollbackRunDate) stats = stats.lte("date", rollbackRunDate);
        const res = await stats.order("date", { ascending: false }).limit(keys.length);
        return { data: aggregateCompetitorPlaylistHistory(res.data ?? []), error: res.error };
      }
      let q = svc.from("playlist_daily_stats")
        .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
        .eq("playlist_key", playlistKey);
      if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
      return await q.order("date", { ascending: false }).limit(1);
    }, `home-playlist-stats-v5-${datasetMode}-${competitorLabelKey ?? "none"}-${playlistKey}-diag-ov${overrideBuster}-rb${rollbackDate ?? "live"}`, CACHE_TTL_1H);
    const latestRunDate = history?.[0]?.date ?? null;
    const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
    let artificialSpikeRatio = 1.25;
    let artificialMinBaseline = 50;
    let artificialGraceDays = 14;
    let artificialThresholdCrossing = 1500;
    let artificialIncludeWeekends = false;
    for (const row of hcRows as Array<{ key?: string; value_numeric?: unknown }>) {
      if (row.value_numeric == null || !Number.isFinite(Number(row.value_numeric))) continue;
      const n = Number(row.value_numeric);
      if (row.key === "artificial_streams_spike_ratio") artificialSpikeRatio = n;
      if (row.key === "artificial_streams_min_baseline") artificialMinBaseline = n;
      if (row.key === "artificial_streams_new_track_grace_days") artificialGraceDays = Math.round(n);
      if (row.key === "artificial_streams_threshold_crossing_max") artificialThresholdCrossing = Math.round(n);
      if (row.key === "artificial_streams_include_weekends") artificialIncludeWeekends = Boolean(Math.round(n));
    }
    if (settings?.artificial_streams_spike_ratio != null && Number.isFinite(Number(settings.artificial_streams_spike_ratio))) {
      artificialSpikeRatio = Number(settings.artificial_streams_spike_ratio);
    }
    if (typeof settings?.artificial_streams_include_weekends_user === "boolean") {
      artificialIncludeWeekends = settings.artificial_streams_include_weekends_user;
    }
    const maxRangeDays = sp.legacy === "1" ? 1200 : 365;
    let rangeDays = Math.max(7, Math.min(maxRangeDays, Number(sp.range ?? "30") || 30));
    if (sp.start && sp.end) {
      const days = Math.ceil((new Date(`${sp.end}T00:00:00Z`).getTime() - new Date(`${sp.start}T00:00:00Z`).getTime()) / 86400000) + 1;
      rangeDays = Math.max(1, Math.min(maxRangeDays, days));
    }
    const validDate = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const date = value.trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ? date : null;
    };
    const start = validDate(sp.start);
    const end = validDate(sp.end);
    let spikeFilterRunStart: string | null = null;
    let spikeFilterRunEnd: string | null = null;
    if (start && end) {
      spikeFilterRunStart = datasetMode === "competitor" ? start : addDaysISO(start, SOT_DATA_LAG_DAYS);
      spikeFilterRunEnd = datasetMode === "competitor" ? end : addDaysISO(end, SOT_DATA_LAG_DAYS);
    } else if (latestRunDate && (datasetMode === "competitor" || latestDataDate)) {
      spikeFilterRunStart = addDaysISO(latestRunDate, -(rangeDays - 1));
      spikeFilterRunEnd = latestRunDate;
    }
    return loadHomeDiagnostics({ svc, datasetMode, competitorLabelKey, playlistKey, latestRunDate, latestDataDate,
      artificialSpikeRatio, artificialMinBaseline, artificialGraceDays, artificialThresholdCrossing,
      artificialIncludeWeekends, spikeFilterRunStart, spikeFilterRunEnd, overrideBuster });
  });
}

type DiagnosticsArgs = {
  svc: ReturnType<typeof supabaseService>;
  datasetMode: "own" | "competitor";
  competitorLabelKey: string | null;
  playlistKey: string;
  latestRunDate: string | null;
  latestDataDate: string | null;
  artificialSpikeRatio: number;
  artificialMinBaseline: number;
  artificialGraceDays: number;
  artificialThresholdCrossing: number;
  artificialIncludeWeekends: boolean;
  spikeFilterRunStart: string | null;
  spikeFilterRunEnd: string | null;
  overrideBuster: string;
};

export async function loadHomeDiagnostics(args: DiagnosticsArgs): Promise<HomeDiagnosticsApiPayload> {
  const { svc, datasetMode, competitorLabelKey, playlistKey, latestRunDate, latestDataDate,
    artificialSpikeRatio, artificialMinBaseline, artificialGraceDays, artificialThresholdCrossing,
    artificialIncludeWeekends, spikeFilterRunStart, spikeFilterRunEnd, overrideBuster } = args;
  const competitorRpcLabelKey =
    datasetMode === "competitor" && competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY
      ? competitorLabelKey
      : null;
  const weekendAnchorDate = datasetMode === "competitor" ? latestRunDate : latestDataDate;

  const artificialSpikesCacheKey = `home-artificial-stream-spikes-v6-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${artificialSpikeRatio}-${artificialMinBaseline}-${artificialGraceDays}-${artificialThresholdCrossing}-${artificialIncludeWeekends ? "wknd1" : "wknd0"}-${spikeFilterRunStart ?? "none"}-${spikeFilterRunEnd ?? "none"}-ov${overrideBuster}`;

  const diagnosticsResults = await timedServerStep("home.diagnostics", () =>
      Promise.all([
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_artist_weekend_dips", {
                p_min_weekday_avg: 0,
                p_anchor_snapshot_date: weekendAnchorDate ?? null,
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_artist_weekend_dips", {
              p_min_weekday_avg: 0,
              p_anchor_data_date: latestDataDate ?? null,
            });
          },
          `home-artist-weekend-dips-v4-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${playlistKey}-${weekendAnchorDate ?? "none"}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_track_weekend_dips", {
                p_min_weekday_avg: 0,
                p_anchor_snapshot_date: weekendAnchorDate ?? null,
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_track_weekend_dips", {
              p_min_weekday_avg: 0,
              p_anchor_data_date: latestDataDate ?? null,
            });
          },
          `home-track-weekend-dips-v4-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${playlistKey}-${weekendAnchorDate ?? "none"}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_negative_daily_streams", {
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_negative_daily_streams");
          },
          `home-negative-daily-v5-${datasetMode}-${competitorRpcLabelKey ?? "none"}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_artificial_stream_spikes", {
                p_spike_ratio: artificialSpikeRatio,
                p_min_baseline: artificialMinBaseline,
                p_grace_days: artificialGraceDays,
                p_threshold_crossing_max: artificialThresholdCrossing,
                p_include_weekends: artificialIncludeWeekends,
                p_start_date: spikeFilterRunStart,
                p_end_date: spikeFilterRunEnd,
                p_label_key: competitorRpcLabelKey,
              });
            }
            const { data, error } = await svc.rpc("home_artificial_stream_spikes", {
              p_spike_ratio: artificialSpikeRatio,
              p_min_baseline: artificialMinBaseline,
              p_grace_days: artificialGraceDays,
              p_threshold_crossing_max: artificialThresholdCrossing,
              p_include_weekends: artificialIncludeWeekends,
              p_start_date: spikeFilterRunStart ?? undefined,
              p_end_date: spikeFilterRunEnd ?? undefined,
            });
            return { data, error };
          },
          artificialSpikesCacheKey,
          CACHE_TTL_1H,
        ),
      ]),
    );

  let artistWeekendDipsRaw: unknown[] = [];
  let trackWeekendDipsRaw: unknown[] = [];
  let negativeDailyStreamsRaw: unknown[] = [];
  let artificialStreamSpikesRaw: unknown[] = [];
  let homeDiagnosticsErrorMessage: string | null = null;

  if (diagnosticsResults) {
    const [
      artistWeekendDipsResult,
      trackWeekendDipsResult,
      negativeDailyStreamsResult,
      artificialStreamSpikesResult,
    ] = diagnosticsResults;
    artistWeekendDipsRaw = (artistWeekendDipsResult.data ?? []) as unknown[];
    trackWeekendDipsRaw = (trackWeekendDipsResult.data ?? []) as unknown[];
    negativeDailyStreamsRaw = (negativeDailyStreamsResult.data ?? []) as unknown[];
    artificialStreamSpikesRaw = (artificialStreamSpikesResult.data ?? []) as unknown[];
    homeDiagnosticsErrorMessage =
      artistWeekendDipsResult.error?.message ??
      trackWeekendDipsResult.error?.message ??
      negativeDailyStreamsResult.error?.message ??
      artificialStreamSpikesResult.error?.message ??
      null;
  }

  const artificialStreamSpikes: ArtificialStreamSpikeRow[] = (artificialStreamSpikesRaw as Record<string, unknown>[]).map(
    (r) => ({
      isrc: String(r.isrc ?? "").trim(),
      name: typeof r.name === "string" ? r.name : String(r.isrc ?? ""),
      artist_names: Array.isArray(r.artist_names) ? (r.artist_names as string[]) : null,
      artist_ids: Array.isArray(r.artist_ids) ? (r.artist_ids as string[]) : null,
      album_image_url: typeof r.album_image_url === "string" ? r.album_image_url : null,
      date: String(r.date ?? "").slice(0, 10),
      daily_streams: Number(r.daily_streams ?? 0) || 0,
      avg_same_dow:
        r.avg_same_dow != null && Number.isFinite(Number(r.avg_same_dow)) ? Number(r.avg_same_dow) : null,
      spike_ratio:
        r.spike_ratio != null && Number.isFinite(Number(r.spike_ratio)) ? Number(r.spike_ratio) : null,
      streams_cumulative: Number(r.streams_cumulative ?? 0) || 0,
    }),
  );

  return {
    artistWeekendDips: (artistWeekendDipsRaw as ArtistWeekendDipRow[] | null) ?? [],
    trackWeekendDips: (trackWeekendDipsRaw as TrackWeekendDipRow[] | null) ?? [],
    negativeDailyStreams: (negativeDailyStreamsRaw as NegativeDailyStreamsRow[] | null) ?? [],
    artificialStreamSpikes,
    errorMessage: homeDiagnosticsErrorMessage,
  };
}
