import { CACHE_TTL_1H } from "@/lib/constants";
import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { addDaysISO, dataDateFromRunDate, runDateFromDataDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

import { loadCompetitorConfigPlaylists } from "./loadCompetitorConfig";
import type {
  CompetitorConfigDriftRow,
  CompetitorHealthKpiFilter,
  CompetitorHealthPageData,
  CompetitorLabelHealthRow,
  CompetitorPipelineStage,
  CompetitorPlaylistHealthRow,
  CompetitorRawExportRow,
  CompetitorUnenrichedTrack,
  CompetitorWarningRow,
} from "./types";

const WARNING_PAGE_SIZE = 50;
const UNENRICHED_PAGE_SIZE = 50;

function sanitizeIsoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  return value.trim();
}

function parseCount(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function buildConfigDrift(
  configPlaylists: ReturnType<typeof loadCompetitorConfigPlaylists>,
  dbPlaylists: Array<{ playlist_key: string; label_key: string; display_name: string; is_active: boolean }>,
): CompetitorConfigDriftRow[] {
  const configKeys = new Set(configPlaylists.map((p) => p.playlist_key));
  const dbByKey = new Map(dbPlaylists.map((p) => [p.playlist_key, p]));
  const drift: CompetitorConfigDriftRow[] = [];

  for (const cfg of configPlaylists) {
    const db = dbByKey.get(cfg.playlist_key);
    if (!db) {
      drift.push({
        playlist_key: cfg.playlist_key,
        issue: "missing_in_db",
        label_key: cfg.label_key,
        display_name: cfg.display_name,
      });
    } else if (db.is_active === false) {
      drift.push({
        playlist_key: cfg.playlist_key,
        issue: "inactive_in_db",
        label_key: db.label_key,
        display_name: db.display_name,
      });
    }
  }

  for (const db of dbPlaylists) {
    if (!configKeys.has(db.playlist_key) && db.is_active !== false) {
      drift.push({
        playlist_key: db.playlist_key,
        issue: "missing_in_config",
        label_key: db.label_key,
        display_name: db.display_name,
      });
    }
  }

  return drift.sort((a, b) => a.playlist_key.localeCompare(b.playlist_key));
}

function buildPipelineStages(args: {
  selectedRunDate: string;
  runStatus: string;
  activePlaylistCount: number;
  staleCount: number;
  mismatchCount: number;
  missingTotals: number;
  missingExportCount: number;
  unenrichedCount: number;
  missingThumbnailCount: number;
}): CompetitorPipelineStage[] {
  const {
    selectedRunDate,
    runStatus,
    activePlaylistCount,
    staleCount,
    mismatchCount,
    missingTotals,
    missingExportCount,
    unenrichedCount,
    missingThumbnailCount,
  } = args;

  const ingestionOk = runStatus === "success";
  const statsOk = activePlaylistCount > 0 && staleCount === 0;
  const exportsOk = activePlaylistCount > 0 && missingExportCount === 0;
  const reconcileOk = mismatchCount === 0;
  const streamsOk = missingTotals === 0;
  const enrichOk = unenrichedCount === 0 && missingThumbnailCount === 0;

  return [
    {
      id: "ingestion",
      label: "Export ingest",
      status: ingestionOk ? "ok" : runStatus === "failed" ? "error" : "warn",
      detail: ingestionOk
        ? `Run ${selectedRunDate} succeeded`
        : `Run ${selectedRunDate} status: ${runStatus}`,
    },
    {
      id: "stats",
      label: "Playlist stats",
      status: statsOk ? "ok" : staleCount > 0 ? "warn" : "pending",
      detail: statsOk
        ? "All active playlists have stats for this run"
        : `${staleCount} playlist(s) missing stats on this run`,
    },
    {
      id: "exports",
      label: "Raw exports",
      status: exportsOk ? "ok" : "warn",
      detail: exportsOk
        ? "Every active playlist has a raw export row"
        : `${missingExportCount} playlist(s) missing export for this run`,
    },
    {
      id: "reconcile",
      label: "Row reconciliation",
      status: reconcileOk ? "ok" : "warn",
      detail: reconcileOk
        ? "Track counts match export row counts"
        : `${mismatchCount} playlist(s) with track/row mismatch`,
    },
    {
      id: "streams",
      label: "Stream totals",
      status: streamsOk ? "ok" : "warn",
      detail: streamsOk
        ? "No missing stream totals on active playlists"
        : `${missingTotals} track(s) missing stream totals`,
    },
    {
      id: "enrichment",
      label: "Spotify enrichment",
      status: enrichOk ? "ok" : "warn",
      detail: enrichOk
        ? "All tracks have artists and artwork"
        : `${unenrichedCount} track(s) need enrichment${missingThumbnailCount > 0 ? ` · ${missingThumbnailCount} playlist(s) missing thumbnails` : ""}`,
    },
  ];
}

function filterPlaylistRows(
  rows: CompetitorPlaylistHealthRow[],
  filter: CompetitorHealthKpiFilter,
): CompetitorPlaylistHealthRow[] {
  if (filter === "all") return rows;
  if (filter === "stale") return rows.filter((r) => r.stale);
  if (filter === "mismatch") return rows.filter((r) => r.row_mismatch);
  if (filter === "missing") return rows.filter((r) => r.missing_streams_track_count > 0);
  if (filter === "no_export") return rows.filter((r) => r.missing_export);
  return rows;
}

export async function loadCompetitorHealthPage(args: {
  dataDateParam?: string | null;
  labelParam?: string | null;
  kpiFilter?: CompetitorHealthKpiFilter;
  warningPage?: number;
  warningSeverity?: "all" | "critical" | "warn";
  unenrichedPage?: number;
  userId: string;
}): Promise<CompetitorHealthPageData> {
  const kpiFilter = args.kpiFilter ?? "all";
  const warningPage = Math.max(1, args.warningPage ?? 1);
  const unenrichedPage = Math.max(1, args.unenrichedPage ?? 1);
  const warningSeverity = args.warningSeverity ?? "all";

  const cacheKey = [
    "health-competitor-v2",
    args.dataDateParam ?? "latest",
    args.labelParam ?? "all",
    kpiFilter,
    warningPage,
    warningSeverity,
    unenrichedPage,
    args.userId,
  ].join("-");

  const cached = await cachedQuery(
    async () => {
      const svc = supabaseService();
      const comp = svc.schema("competitor");

      const { data: settings } = await svc
        .from("user_settings")
        .select("competitor_label_key")
        .eq("user_id", args.userId)
        .maybeSingle();

      const preferredLabel =
        args.labelParam?.trim() ||
        (typeof settings?.competitor_label_key === "string" ? settings.competitor_label_key.trim() : "") ||
        null;

      const [
        { data: runsRaw, error: runsErr },
        { data: labelsRaw },
        { data: playlistsRaw },
        { count: unenrichedTotal },
        { count: missingThumbCount },
      ] = await Promise.all([
        comp
          .from("ingestion_runs")
          .select("id,run_date,status,started_at,finished_at,logs_url")
          .order("run_date", { ascending: false })
          .limit(30),
        comp.from("labels").select("label_key,display_name,is_active").order("display_name"),
        comp
          .from("playlists")
          .select("playlist_key,label_key,display_name,spotify_playlist_image_url,is_active")
          .order("label_key")
          .order("display_order", { ascending: true, nullsFirst: false }),
        comp
          .from("tracks")
          .select("isrc", { count: "exact", head: true })
          .or("spotify_artist_ids.is.null,spotify_album_image_url.is.null"),
        comp
          .from("playlists")
          .select("playlist_key", { count: "exact", head: true })
          .eq("is_active", true)
          .is("spotify_playlist_image_url", null),
      ]);

      if (runsErr) return { data: null, error: runsErr };

      const runs = (runsRaw ?? []) as Array<Record<string, unknown>>;
      const latestRunDate = String(runs[0]?.run_date ?? "").slice(0, 10) || null;
      const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;

      const requestedDataDate = sanitizeIsoDate(args.dataDateParam) ?? latestDataDate;
      const selectedRunDate = requestedDataDate
        ? runDateFromDataDate(requestedDataDate)
        : latestRunDate;
      const selectedDataDate = selectedRunDate ? dataDateFromRunDate(selectedRunDate) : null;
      const prevRunDate = selectedRunDate ? addDaysISO(selectedRunDate, -1) : null;

      const selectedRun = runs.find((r) => String(r.run_date).slice(0, 10) === selectedRunDate);
      const selectedRunId = selectedRun?.id != null ? Number(selectedRun.id) : null;
      const runStatus = String(selectedRun?.status ?? "unknown");

      const labels = (labelsRaw ?? []) as Array<{
        label_key: string;
        display_name: string;
        is_active: boolean;
      }>;
      const labelNameByKey = new Map(labels.map((l) => [l.label_key, l.display_name]));
      const playlists = (playlistsRaw ?? []) as Array<{
        playlist_key: string;
        label_key: string;
        display_name: string;
        spotify_playlist_image_url: string | null;
        is_active: boolean;
      }>;
      const activePlaylists = playlists.filter((p) => p.is_active !== false);

      const labelFilter =
        preferredLabel && !isAllCompetitorsKey(preferredLabel) ? preferredLabel : null;
      const scopedPlaylists = labelFilter
        ? activePlaylists.filter((p) => p.label_key === labelFilter)
        : activePlaylists;

      const playlistKeys = scopedPlaylists.map((p) => p.playlist_key);

      const [
        statsResult,
        exportsResult,
        distinctTracksResult,
        warningsCountResult,
        warningsRowsResult,
        unenrichedRowsResult,
      ] = await Promise.all([
        selectedRunDate && prevRunDate && playlistKeys.length
          ? comp
              .from("playlist_daily_stats")
              .select(
                "date,playlist_key,track_count,total_streams_cumulative,daily_streams_net,missing_streams_track_count",
              )
              .in("date", [prevRunDate, selectedRunDate])
              .in("playlist_key", playlistKeys)
          : Promise.resolve({ data: [], error: null }),
        selectedRunId
          ? comp
              .from("raw_exports")
              .select(
                "playlist_key,rows_count,exported_at,storage_bucket,object_key",
              )
              .eq("run_id", selectedRunId)
              .order("exported_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        selectedRunDate
          ? comp.rpc("label_distinct_track_counts", { p_run_date: selectedRunDate })
          : Promise.resolve({ data: [], error: null }),
        selectedRunDate
          ? (() => {
              let q = comp
                .from("ingestion_warnings")
                .select("id", { count: "exact", head: true })
                .eq("run_date", selectedRunDate);
              if (warningSeverity !== "all") q = q.eq("severity", warningSeverity);
              return q;
            })()
          : Promise.resolve({ count: 0, error: null }),
        selectedRunDate
          ? (() => {
              const from = (warningPage - 1) * WARNING_PAGE_SIZE;
              const to = from + WARNING_PAGE_SIZE - 1;
              let q = comp
                .from("ingestion_warnings")
                .select(
                  "id,created_at,playlist_key,severity,code,message,details_json",
                )
                .eq("run_date", selectedRunDate)
                .order("created_at", { ascending: false })
                .range(from, to);
              if (warningSeverity !== "all") q = q.eq("severity", warningSeverity);
              return q;
            })()
          : Promise.resolve({ data: [], error: null }),
        comp.rpc("unenriched_tracks_paged", {
          p_offset: (unenrichedPage - 1) * UNENRICHED_PAGE_SIZE,
          p_limit: UNENRICHED_PAGE_SIZE,
        }),
      ]);

      const stats = (statsResult.data ?? []) as Array<{
        date: string;
        playlist_key: string;
        track_count: number | null;
        daily_streams_net: number | null;
        missing_streams_track_count: number | null;
      }>;

      const latestStatByPlaylist = new Map<string, (typeof stats)[0]>();
      const previousStatByPlaylist = new Map<string, (typeof stats)[0]>();
      for (const stat of stats) {
        const date = String(stat.date).slice(0, 10);
        if (date === selectedRunDate) {
          latestStatByPlaylist.set(stat.playlist_key, stat);
        } else if (date === prevRunDate) {
          previousStatByPlaylist.set(stat.playlist_key, stat);
        }
      }

      const exportByPlaylist = new Map<
        string,
        {
          rows_count: number;
          exported_at: string;
          storage_bucket: string | null;
          object_key: string;
        }
      >();
      for (const row of exportsResult.data ?? []) {
        const pk = String((row as { playlist_key?: string }).playlist_key ?? "");
        if (!pk || exportByPlaylist.has(pk)) continue;
        exportByPlaylist.set(pk, {
          rows_count: parseCount((row as { rows_count?: unknown }).rows_count),
          exported_at: String((row as { exported_at?: string }).exported_at ?? ""),
          storage_bucket: ((row as { storage_bucket?: string | null }).storage_bucket ?? null) as
            | string
            | null,
          object_key: String((row as { object_key?: string }).object_key ?? ""),
        });
      }

      const distinctByLabel = new Map<string, number>();
      for (const row of distinctTracksResult.data ?? []) {
        distinctByLabel.set(
          String((row as { label_key?: string }).label_key ?? ""),
          parseCount((row as { track_count?: unknown }).track_count),
        );
      }

      const playlistRows: CompetitorPlaylistHealthRow[] = scopedPlaylists.map((playlist) => {
        const stat = latestStatByPlaylist.get(playlist.playlist_key);
        const prev = previousStatByPlaylist.get(playlist.playlist_key);
        const exportRow = exportByPlaylist.get(playlist.playlist_key);
        const stale = !stat || String(stat.date).slice(0, 10) !== selectedRunDate;
        const row_mismatch =
          stat?.track_count != null &&
          exportRow?.rows_count != null &&
          Number(stat.track_count) !== Number(exportRow.rows_count);
        const missing_export = !exportRow;
        const track_swing =
          stat?.track_count != null && prev?.track_count != null
            ? Number(stat.track_count) - Number(prev.track_count)
            : null;
        const missing_streams_track_count = Number(stat?.missing_streams_track_count ?? 0);
        const bad = stale || row_mismatch || missing_export || missing_streams_track_count > 0;

        return {
          playlist_key: playlist.playlist_key,
          label_key: playlist.label_key,
          display_name: playlist.display_name,
          spotify_playlist_image_url: playlist.spotify_playlist_image_url,
          latest_data_date: stat?.date ? dataDateFromRunDate(String(stat.date).slice(0, 10)) : null,
          track_count: stat?.track_count ?? null,
          export_rows_count: exportRow?.rows_count ?? null,
          daily_streams_net: stat?.daily_streams_net ?? null,
          missing_streams_track_count,
          track_swing,
          stale,
          row_mismatch,
          missing_export,
          bad,
        };
      });

      const labelKeysInScope = [...new Set(scopedPlaylists.map((p) => p.label_key))];
      const labelRows: CompetitorLabelHealthRow[] = labelKeysInScope
        .map((labelKey) => {
          const labelPlaylists = playlistRows.filter((p) => p.label_key === labelKey);
          return {
            label_key: labelKey,
            display_name: labelNameByKey.get(labelKey) ?? labelKey,
            playlist_count: labelPlaylists.length,
            distinct_tracks: distinctByLabel.get(labelKey) ?? null,
            summed_track_count: labelPlaylists.reduce((s, p) => s + Number(p.track_count ?? 0), 0),
            missing_totals: labelPlaylists.reduce(
              (s, p) => s + p.missing_streams_track_count,
              0,
            ),
            stale_playlists: labelPlaylists.filter((p) => p.stale).length,
            row_mismatches: labelPlaylists.filter((p) => p.row_mismatch).length,
            missing_exports: labelPlaylists.filter((p) => p.missing_export).length,
          };
        })
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      const exports: CompetitorRawExportRow[] = scopedPlaylists
        .map((playlist) => {
          const exportRow = exportByPlaylist.get(playlist.playlist_key);
          if (!exportRow) return null;
          const download_href =
            exportRow.storage_bucket && exportRow.object_key
              ? `/exports?bucket=${encodeURIComponent(exportRow.storage_bucket)}&key=${encodeURIComponent(exportRow.object_key)}`
              : null;
          return {
            playlist_key: playlist.playlist_key,
            label_key: playlist.label_key,
            display_name: playlist.display_name,
            rows_count: exportRow.rows_count,
            exported_at: exportRow.exported_at,
            storage_bucket: exportRow.storage_bucket,
            object_key: exportRow.object_key,
            download_href,
          };
        })
        .filter((r): r is CompetitorRawExportRow => r != null)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      const stalePlaylists = playlistRows.filter((p) => p.stale).length;
      const rowMismatches = playlistRows.filter((p) => p.row_mismatch).length;
      const missingTotals = playlistRows.reduce((s, p) => s + p.missing_streams_track_count, 0);
      const missingExports = playlistRows.filter((p) => p.missing_export).length;

      const warningsTotal = warningsCountResult.count ?? 0;
      const warningRows: CompetitorWarningRow[] = ((warningsRowsResult.data ?? []) as Array<
        Record<string, unknown>
      >).map((w) => {
        const playlistKey = w.playlist_key ? String(w.playlist_key) : null;
        const playlist = playlistKey
          ? playlists.find((p) => p.playlist_key === playlistKey)
          : null;
        const labelKey = playlist?.label_key ?? null;
        return {
          id: Number(w.id ?? 0),
          created_at: String(w.created_at ?? ""),
          playlist_key: playlistKey,
          playlist_display_name: playlist?.display_name ?? playlistKey,
          label_key: labelKey,
          label_display_name: labelKey ? labelNameByKey.get(labelKey) ?? labelKey : null,
          severity: String(w.severity ?? ""),
          code: String(w.code ?? ""),
          message: String(w.message ?? ""),
          details_json:
            w.details_json && typeof w.details_json === "object"
              ? (w.details_json as Record<string, unknown>)
              : null,
        };
      });

      const unenrichedRows: CompetitorUnenrichedTrack[] = ((unenrichedRowsResult.data ?? []) as Array<
        Record<string, unknown>
      >).map((t) => ({
        isrc: String(t.isrc ?? ""),
        name: String(t.name ?? t.isrc ?? ""),
        album_image_url: (t.album_image_url as string | null) ?? null,
        missing_artists: Boolean(t.missing_artists),
        missing_image: Boolean(t.missing_image),
      }));

      const configDrift = buildConfigDrift(loadCompetitorConfigPlaylists(), playlists);

      const pipelineStages = buildPipelineStages({
        selectedRunDate: selectedRunDate ?? "—",
        runStatus,
        activePlaylistCount: scopedPlaylists.length,
        staleCount: stalePlaylists,
        mismatchCount: rowMismatches,
        missingTotals,
        missingExportCount: missingExports,
        unenrichedCount: unenrichedTotal ?? 0,
        missingThumbnailCount: missingThumbCount ?? 0,
      });

      const runOptions = runs
        .map((r) => {
          const run_date = String(r.run_date ?? "").slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(run_date)) return null;
          return {
            run_date,
            data_date: dataDateFromRunDate(run_date),
            status: String(r.status ?? "unknown"),
          };
        })
        .filter((r): r is { run_date: string; data_date: string; status: string } => r != null);

      return {
        data: {
          selectedDataDate,
          selectedRunDate,
          latestRunDate,
          latestDataDate,
          runOptions,
          selectedLabelKey: labelFilter,
          labelOptions: labels
            .filter((l) => l.is_active !== false)
            .map((l) => ({ label_key: l.label_key, display_name: l.display_name })),
          kpiFilter,
          kpis: {
            failedRuns: runs.filter((r) => String(r.status ?? "") !== "success").length,
            stalePlaylists,
            rowMismatches,
            missingTotals,
            unenrichedTracks: unenrichedTotal ?? 0,
            missingExports,
            missingThumbnails: missingThumbCount ?? 0,
          },
          pipelineStages,
          labelRows,
          playlistRows: filterPlaylistRows(playlistRows, kpiFilter),
          exports,
          warnings: {
            rows: warningRows,
            totalCount: warningsTotal,
            page: warningPage,
            pageSize: WARNING_PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(warningsTotal / WARNING_PAGE_SIZE)),
            severityFilter: warningSeverity,
          },
          configDrift,
          unenriched: {
            rows: unenrichedRows,
            totalCount: unenrichedTotal ?? 0,
            page: unenrichedPage,
            pageSize: UNENRICHED_PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil((unenrichedTotal ?? 0) / UNENRICHED_PAGE_SIZE)),
          },
          runs: runs.map((r) => ({
            run_date: String(r.run_date ?? "").slice(0, 10),
            data_date: dataDateFromRunDate(String(r.run_date ?? "").slice(0, 10)),
            status: String(r.status ?? "unknown"),
            started_at: r.started_at ? String(r.started_at) : null,
            finished_at: r.finished_at ? String(r.finished_at) : null,
            logs_url: r.logs_url ? String(r.logs_url) : null,
          })),
        } satisfies CompetitorHealthPageData,
        error: null,
      };
    },
    cacheKey,
    CACHE_TTL_1H,
  );

  if (cached.error || !cached.data) {
    throw new Error(cached.error?.message ?? "Failed to load competitor health data");
  }

  return cached.data;
}
