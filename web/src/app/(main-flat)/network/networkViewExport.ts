import { fetchApiJson } from "@/lib/api";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import {
  downloadNetworkViewXlsx,
  type NetworkArtistStreamExportRow,
  type NetworkTrackSheetEnrichment,
  type NetworkViewExportEdge,
} from "@/lib/networkViewXlsx";
import { SPOTIBASE_PUBLIC_ORIGIN } from "./networkGraphConstants";
import type { GraphEdge, GraphNode } from "./networkTypes";

/**
 * Builds and downloads the multi-sheet `.xlsx` for the current network view: batches ISRC
 * track metadata and artist stream totals, then writes the workbook. Progress and non-fatal
 * issues go through `setXlsxExportPhase` / `setXlsxExportAlert`; fatal errors throw to the caller.
 */
export async function runNetworkViewXlsxExport({
  networkExportScopeLabel,
  hideNonPrimary,
  collabFilterExportLabel,
  collabCountBasisLabel,
  graphData,
  nodes,
  edges,
  trackCollabFilterMap,
  playlistKey,
  pathname,
  searchParams,
  setXlsxExportPhase,
  setXlsxExportAlert,
}: {
  networkExportScopeLabel: string;
  hideNonPrimary: boolean;
  collabFilterExportLabel: string;
  collabCountBasisLabel: string;
  /** Currently visible (filtered) graph. */
  graphData: { nodes: GraphNode[]; links: GraphEdge[] };
  /** Full (unfiltered) graph. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  trackCollabFilterMap: Map<string, number>;
  playlistKey: string | null;
  pathname: string | null;
  searchParams: { toString(): string };
  setXlsxExportPhase: (phase: string | null) => void;
  setXlsxExportAlert: (alert: string | null) => void;
}): Promise<void> {
  const scopeSlug = slugifyForFilename(networkExportScopeLabel);
  const isrcSet = new Set<string>();
  for (const e of graphData.links) {
    for (const t of e.shared_tracks ?? []) {
      const id = String(t.isrc ?? "").trim();
      if (id) isrcSet.add(id);
    }
  }
  const isrcList = [...isrcSet];
  const trackEnrichment = new Map<string, NetworkTrackSheetEnrichment>();
  const ISRC_BATCH = 3500;
  const ISRC_PARALLEL = 3;
  let trackEnrichmentBatchFailures = 0;

  const artistIdsForStats = graphData.nodes
    .map((n) => n.id)
    .filter((id) => String(id).trim().length > 0);

  const artistStreamStatsPromise = (async (): Promise<{
    map: Map<string, NetworkArtistStreamExportRow>;
    ok: boolean;
  }> => {
    if (!artistIdsForStats.length) {
      return { map: new Map(), ok: true };
    }
    try {
      const js = await fetchApiJson<{
        rows?: Array<{
          artist_id: string;
          total_streams_in_scope: number;
          daily_streams_in_scope: number;
          tracks_all_catalog: number;
          total_streams_all_catalog: number;
          daily_streams_all_catalog: number;
        }>;
      }>("/api/admin/network-export-artist-stream-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistIds: artistIdsForStats,
          playlistKey: playlistKey ?? null,
          hideNonPrimary,
        }),
      });
      const map = new Map<string, NetworkArtistStreamExportRow>();
      for (const r of js.rows ?? []) {
        map.set(r.artist_id, {
          total_streams_in_scope: r.total_streams_in_scope,
          daily_streams_in_scope: r.daily_streams_in_scope,
          tracks_all_catalog: r.tracks_all_catalog,
          total_streams_all_catalog: r.total_streams_all_catalog,
          daily_streams_all_catalog: r.daily_streams_all_catalog,
        });
      }
      return { map, ok: true };
    } catch (e) {
      console.error("network-export-artist-stream-stats:", e);
      return { map: new Map(), ok: false };
    }
  })();

  const parts: string[][] = [];
  for (let i = 0; i < isrcList.length; i += ISRC_BATCH) {
    parts.push(isrcList.slice(i, i + ISRC_BATCH));
  }

  if (parts.length) {
    setXlsxExportPhase(`Track metadata 0/${parts.length}`);
  } else if (artistIdsForStats.length) {
    setXlsxExportPhase("Loading artist stream totals…");
  }

  let nextBatchIdx = 0;
  let completedBatches = 0;

  async function fetchOneIsrcBatch(part: string[]): Promise<void> {
    let j: {
      tracks?: Array<{
        isrc: string;
        name: string | null;
        release_date: string | null;
        totalStreams: number | null;
        dailyStreams: number | null;
        artistsOnTrack?: string;
        distroPlaylists?: string;
        spotify_track_id?: string | null;
      }>;
    };
    try {
      j = await fetchApiJson("/api/admin/isrc-batch-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isrcs: part }),
      });
    } catch (e) {
      trackEnrichmentBatchFailures += 1;
      console.error("isrc-batch-details for export:", e);
      return;
    }
    for (const t of j.tracks ?? []) {
      const sid = t.spotify_track_id;
      trackEnrichment.set(t.isrc, {
        catalogName: t.name,
        artistsOnTrack: t.artistsOnTrack ?? "",
        totalStreams: t.totalStreams ?? null,
        dailyStreams: t.dailyStreams ?? null,
        releaseDate: t.release_date,
        distroPlaylists: t.distroPlaylists ?? "",
        spotifyTrackId: typeof sid === "string" && sid.trim() ? sid.trim() : null,
      });
    }
  }

  async function isrcWorker(): Promise<void> {
    while (true) {
      const i = nextBatchIdx++;
      if (i >= parts.length) break;
      await fetchOneIsrcBatch(parts[i]!);
      completedBatches += 1;
      setXlsxExportPhase(`Track metadata ${completedBatches}/${parts.length}`);
    }
  }

  const workerCount = parts.length === 0 ? 0 : Math.min(ISRC_PARALLEL, parts.length);
  await Promise.all(Array.from({ length: workerCount }, () => isrcWorker()));

  setXlsxExportPhase("Finishing data…");
  const { map: artistStreamStatsById, ok: artistStreamStatsOk } = await artistStreamStatsPromise;

  setXlsxExportPhase("Building spreadsheet…");
  const qs = searchParams.toString();
  const pageUrl = `${SPOTIBASE_PUBLIC_ORIGIN}${pathname || ""}${qs ? `?${qs}` : ""}`;
  const exportOrigin = SPOTIBASE_PUBLIC_ORIGIN;

  await downloadNetworkViewXlsx({
    meta: {
      scopeLabel: networkExportScopeLabel,
      hideNonPrimary,
      collabFilterLabel: collabFilterExportLabel,
      collabCountBasisLabel,
      exportedAtIso: new Date().toISOString(),
      pageUrl,
      fullGraphArtistCount: nodes.length,
      fullGraphCollaborationCount: edges.length,
      trackEnrichmentIsrcRequested: isrcList.length,
      trackEnrichmentIsrcLoaded: trackEnrichment.size,
      trackEnrichmentBatchFailures,
    },
    viewNodes: graphData.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      track_count: n.track_count,
    })),
    viewEdges: graphData.links as unknown as NetworkViewExportEdge[],
    fullEdges: edges as unknown as NetworkViewExportEdge[],
    fullArtistNameById: new Map(nodes.map((n) => [n.id, n.name])),
    fullCollabCountById: trackCollabFilterMap,
    filenameBase: `network_${scopeSlug}_${todayIsoDate()}`,
    exportOrigin,
    trackEnrichment,
    artistStreamStatsById,
  });

  const issues: string[] = [];
  if (trackEnrichmentBatchFailures > 0) {
    issues.push(
      `${trackEnrichmentBatchFailures} track metadata batch request(s) failed`,
    );
  }
  if (!artistStreamStatsOk && artistIdsForStats.length > 0) {
    issues.push("Artist stream totals could not be loaded");
  }
  if (issues.length) {
    setXlsxExportAlert(
      `${issues.join(". ")}. The file still downloaded; check the Summary sheet and empty columns.`,
    );
  }
}
