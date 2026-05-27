import type { User } from "@supabase/supabase-js";

import type {
  LabelComparisonRow,
  LabelDailyPoint,
  LabelRow,
  PlaylistRow,
} from "@/app/(main-flat)/competitors/competitorsTypes";
import {
  aggregateSeriesByLabel,
  buildLabelComparisonRows,
  buildStatsByDataDate,
  type AnchoredStatRow,
} from "@/app/(main-flat)/competitors/competitorsUtils";
import { DEFAULT_CHART_START_DATE_ISO, normalizeIsoDateOrNull } from "@/components/charts/chartUtils";
import { CACHE_TTL_1H } from "@/lib/constants";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { addDaysISO, dataDateFromRunDate, runDateFromDataDate } from "@/lib/sotDates";
import { capRunDate, getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { cachedQueries } from "@/lib/supabase/cache";
import { isMissingPostgresFunctionError } from "@/lib/supabase/rpcErrors";
import { supabaseService } from "@/lib/supabase/service";

type LabelArtistCountRow = {
  label_key: string;
  artist_count: number | string;
};

type LabelDailySeriesRow = {
  date: string;
  label_key: string;
  daily_streams_net: number | string | null;
  total_streams_cumulative: number | string | null;
  track_count: number | string | null;
};

function parseCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function mapLabelSeriesRows(rows: LabelDailySeriesRow[]): LabelDailyPoint[] {
  return rows
    .map((row) => ({
      date: dataDateFromRunDate(String(row.date).slice(0, 10)),
      label_key: String(row.label_key),
      daily_streams_net: Number(row.daily_streams_net ?? 0),
      total_streams_cumulative: Number(row.total_streams_cumulative ?? 0),
      track_count: Number(row.track_count ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label_key.localeCompare(b.label_key));
}

export type CompetitorsPageCoreProps = {
  labels: LabelRow[];
  comparisonRows: LabelComparisonRow[];
  labelSeries: LabelDailyPoint[];
  latestDataDate: string;
  latestRunDate: string;
  selectedCompetitorLabelKey: string | null;
  playlistsByLabel: Record<string, PlaylistRow[]>;
};

export type CompetitorsPageLoadResult =
  | { status: "wrong-mode" }
  | { status: "no-data" }
  | { status: "ok"; data: CompetitorsPageCoreProps };

export async function loadCompetitorsPageCore(user: User): Promise<CompetitorsPageLoadResult> {
  const svc = supabaseService();
  const comp = svc.schema("competitor");

  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode,competitor_label_key,chart_start_date")
    .eq("user_id", user.id)
    .maybeSingle();

  if (normalizeDatasetMode(settings?.dataset_mode) !== "competitor") {
    return { status: "wrong-mode" };
  }

  const chartStartDataDate =
    normalizeIsoDateOrNull(
      (settings as { chart_start_date?: unknown } | null)?.chart_start_date,
    ) ?? DEFAULT_CHART_START_DATE_ISO;

  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;
  const rollbackSuffix = rollbackDate ?? "live";

  let recentRunsQuery = comp
    .from("ingestion_runs")
    .select("run_date,status,started_at,finished_at")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(1);
  if (rollbackRunDate) recentRunsQuery = recentRunsQuery.lte("run_date", rollbackRunDate);

  const cacheBase = `competitors-core-v2-${rollbackSuffix}`;

  const results = await cachedQueries(
    {
      labels: async () =>
        await comp
          .from("labels")
          .select("label_key,display_name,is_active,accent_hex")
          .order("display_name", { ascending: true }),
      playlists: async () =>
        await comp
          .from("playlists")
          .select(
            "playlist_key,label_key,display_name,spotify_playlist_image_url,sot_dashboard_url,display_order,is_active",
          )
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true }),
      recentRuns: async () => await recentRunsQuery,
    },
    cacheBase,
    CACHE_TTL_1H,
  );

  const labels = (results.labels.data ?? []) as LabelRow[];
  const playlists = (results.playlists.data ?? []) as PlaylistRow[];
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const playlistToLabel = new Map(playlists.map((p) => [p.playlist_key, p.label_key]));

  const recentRuns = (results.recentRuns.data ?? []) as Array<{ run_date: string }>;
  const latestRunDate = capRunDate(recentRuns[0]?.run_date?.slice(0, 10) ?? null, rollbackDate);
  if (!latestRunDate) return { status: "no-data" };

  const latestDataDate = dataDateFromRunDate(latestRunDate);
  const previousDataDate = addDaysISO(latestDataDate, -1);
  const weekAgoDataDate = addDaysISO(latestDataDate, -7);

  const floorDataDate = addDaysISO(latestDataDate, -90);
  const seriesStartDataDate =
    chartStartDataDate > floorDataDate ? chartStartDataDate : floorDataDate;
  const seriesStartRun = runDateFromDataDate(seriesStartDataDate);

  const anchorRunDates = [
    runDateFromDataDate(latestDataDate),
    runDateFromDataDate(previousDataDate),
    runDateFromDataDate(weekAgoDataDate),
  ];

  const dataCacheBase = `${cacheBase}-${latestRunDate}-${seriesStartRun}`;

  const dataResults = await cachedQueries(
    {
      anchoredStats: async () =>
        playlistKeys.length > 0
          ? await comp
              .from("playlist_daily_stats")
              .select(
                "playlist_key,date,track_count,total_streams_cumulative,missing_streams_track_count,daily_streams_net",
              )
              .in("date", anchorRunDates)
              .in("playlist_key", playlistKeys)
          : { data: [] as AnchoredStatRow[], error: null },
      labelSeries: async () => {
        const rpc = await comp.rpc("label_daily_series", {
          p_start_date: seriesStartRun,
          p_end_date: latestRunDate,
        });
        if (!rpc.error) return rpc;
        if (!isMissingPostgresFunctionError(rpc.error) || playlistKeys.length === 0) return rpc;
        return await comp
          .from("playlist_daily_stats")
          .select("date,playlist_key,daily_streams_net,total_streams_cumulative,track_count")
          .gte("date", seriesStartRun)
          .lte("date", latestRunDate)
          .in("playlist_key", playlistKeys);
      },
      artistCounts: async () =>
        await comp.rpc("label_distinct_artist_counts", {
          p_run_date: runDateFromDataDate(latestDataDate),
        }),
      previousArtistCounts: async () =>
        await comp.rpc("label_distinct_artist_counts", {
          p_run_date: runDateFromDataDate(previousDataDate),
        }),
      weekAgoArtistCounts: async () =>
        await comp.rpc("label_distinct_artist_counts", {
          p_run_date: runDateFromDataDate(weekAgoDataDate),
        }),
      weekAgoStats: async () =>
        await comp.rpc("playlist_daily_stats_as_of", {
          p_as_of_date: runDateFromDataDate(weekAgoDataDate),
        }),
    },
    dataCacheBase,
    CACHE_TTL_1H,
  );

  const statsByDataDate = buildStatsByDataDate((dataResults.anchoredStats.data ?? []) as AnchoredStatRow[]);

  if (weekAgoDataDate) {
    const byPlaylist = statsByDataDate.get(weekAgoDataDate) ?? new Map();
    for (const row of (dataResults.weekAgoStats.data ?? []) as AnchoredStatRow[]) {
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

  const artistCountByLabel = new Map<string, number>();
  for (const row of (dataResults.artistCounts.data ?? []) as LabelArtistCountRow[]) {
    artistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const previousArtistCountByLabel = new Map<string, number>();
  for (const row of (dataResults.previousArtistCounts.data ?? []) as LabelArtistCountRow[]) {
    previousArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const weekAgoArtistCountByLabel = new Map<string, number>();
  for (const row of (dataResults.weekAgoArtistCounts.data ?? []) as LabelArtistCountRow[]) {
    weekAgoArtistCountByLabel.set(row.label_key, parseCount(row.artist_count));
  }

  const playlistsByLabel = new Map<string, PlaylistRow[]>();
  for (const playlist of playlists) {
    const rows = playlistsByLabel.get(playlist.label_key) ?? [];
    rows.push(playlist);
    playlistsByLabel.set(playlist.label_key, rows);
  }

  const labelSeriesRaw = dataResults.labelSeries.data ?? [];
  const labelSeriesSample = (labelSeriesRaw as Array<Record<string, unknown>>)[0];
  const labelSeries =
    labelSeriesSample?.label_key != null
      ? mapLabelSeriesRows(labelSeriesRaw as LabelDailySeriesRow[])
      : aggregateSeriesByLabel(
          labelSeriesRaw as Array<{
            date: string;
            playlist_key: string;
            daily_streams_net: number | null;
            total_streams_cumulative: number | null;
            track_count: number | null;
          }>,
          playlistToLabel,
        );

  const comparisonRows = buildLabelComparisonRows({
    labels,
    playlistsByLabel,
    labelSeries,
    latestDataDate,
    previousDataDate,
    weekAgoDataDate,
    statsByDataDate,
    artistCountByLabel,
    previousArtistCountByLabel,
    weekAgoArtistCountByLabel,
  });

  const playlistsByLabelRecord: Record<string, PlaylistRow[]> = {};
  for (const [key, rows] of playlistsByLabel) {
    playlistsByLabelRecord[key] = rows;
  }

  const selectedCompetitorLabelKey =
    typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
      ? settings.competitor_label_key.trim()
      : null;

  return {
    status: "ok",
    data: {
      labels,
      comparisonRows,
      labelSeries,
      latestDataDate,
      latestRunDate,
      selectedCompetitorLabelKey,
      playlistsByLabel: playlistsByLabelRecord,
    },
  };
}
