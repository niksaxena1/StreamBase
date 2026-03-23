/**
 * Build and download an .xlsx snapshot of the current network graph view (client-side).
 */

export type NetworkViewExportNode = {
  id: string;
  name: string;
  track_count: number;
};

/** Force-graph may replace source/target with node objects; normalize before export. */
export type NetworkViewExportEdge = {
  source: unknown;
  target: unknown;
  weight: number;
  shared_tracks: Array<{ isrc: string; name: string | null }>;
};

export type NetworkTrackSheetEnrichment = {
  /** Preferred track title from catalog (tracks.name). */
  catalogName: string | null;
  /** Full credited artists, comma-separated; names containing commas are quoted. */
  artistsOnTrack: string;
  totalStreams: number | null;
  dailyStreams: number | null;
  releaseDate: string | null;
  /** Distro playlist display names, comma-separated */
  distroPlaylists: string;
};

function linkEndpointId(end: unknown): string {
  if (end && typeof end === "object" && "id" in end) {
    return String((end as { id: string }).id);
  }
  return String(end);
}

function normalizeExportEdge(e: NetworkViewExportEdge): {
  source: string;
  target: string;
  weight: number;
  shared_tracks: Array<{ isrc: string; name: string | null }>;
} {
  return {
    source: linkEndpointId(e.source),
    target: linkEndpointId(e.target),
    weight: e.weight,
    shared_tracks: e.shared_tracks ?? [],
  };
}

export type NetworkViewExportMeta = {
  /** Human-readable scope, e.g. playlist name or "All catalog" */
  scopeLabel: string;
  hideNonPrimary: boolean;
  /** Describes collaborator filter, e.g. "None" or "≤5 collaborators" */
  collabFilterLabel: string;
  exportedAtIso: string;
};

function degreeInView(nodeId: string, edges: NetworkViewExportEdge[]): number {
  const nb = new Set<string>();
  for (const raw of edges) {
    const e = normalizeExportEdge(raw);
    if (e.source === nodeId) nb.add(e.target);
    else if (e.target === nodeId) nb.add(e.source);
  }
  return nb.size;
}

/** Comma-separated; quotes segments that contain comma or double-quote (Excel-friendly). */
function joinCellListForSpreadsheet(values: string[]): string {
  if (!values.length) return "";
  return values
    .map((s) => {
      const t = String(s).trim();
      if (t.includes(",") || t.includes('"')) return `"${t.replace(/"/g, '""')}"`;
      return t;
    })
    .join(", ");
}

function buildNeighborIdsByArtist(fullEdges: NetworkViewExportEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const raw of fullEdges) {
    const e = normalizeExportEdge(raw);
    if (!m.has(e.source)) m.set(e.source, new Set());
    if (!m.has(e.target)) m.set(e.target, new Set());
    m.get(e.source)!.add(e.target);
    m.get(e.target)!.add(e.source);
  }
  return m;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned || "Sheet";
}

/** Excel 1900 date system serial (UTC calendar date from YYYY-MM-DD). */
function releaseDateStringToExcelSerial(raw: string): number | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
  const utc = Date.UTC(y, mo, day);
  const excelEpoch = Date.UTC(1899, 11, 30);
  return (utc - excelEpoch) / 86400000;
}

/** Coerce release_date cells to numeric Excel dates so Excel formats/sorts them as dates. */
function formatReleaseDateColumnAsExcelDates(
  ws: import("xlsx").WorkSheet,
  utils: typeof import("xlsx").utils,
  releaseCol: number,
  rowCountExcludingHeader: number,
) {
  for (let r = 1; r <= rowCountExcludingHeader; r++) {
    const addr = utils.encode_cell({ r, c: releaseCol });
    const cell = ws[addr] as import("xlsx").CellObject | undefined;
    if (!cell) continue;
    const raw = cell.v;
    if (raw === "" || raw == null) continue;
    const serial = releaseDateStringToExcelSerial(String(raw));
    if (serial == null) continue;
    ws[addr] = { t: "n", v: serial, z: "yyyy-mm-dd" };
  }
}

export async function downloadNetworkViewXlsx(args: {
  meta: NetworkViewExportMeta;
  viewNodes: NetworkViewExportNode[];
  viewEdges: NetworkViewExportEdge[];
  /** Full collaboration edges for the loaded graph (same scope as the RPC), for neighbor names. */
  fullEdges: NetworkViewExportEdge[];
  /** Every artist id → display name in the loaded graph (typically all `nodes` from the page). */
  fullArtistNameById: Map<string, string>;
  fullCollabCountById: Map<string, number>;
  filenameBase: string;
  /** Per-ISRC rows from /api/admin/isrc-batch-details (optional). */
  trackEnrichment?: Map<string, NetworkTrackSheetEnrichment>;
}): Promise<void> {
  const XLSX = await import("xlsx");

  const nodeById = new Map(args.viewNodes.map((n) => [n.id, n]));
  const normEdges = args.viewEdges.map(normalizeExportEdge);
  const neighborIdsByArtist = buildNeighborIdsByArtist(args.fullEdges);

  const summaryAoa: Array<Array<string | number | boolean>> = [
    ["Field", "Value"],
    ["Exported at (UTC)", args.meta.exportedAtIso],
    ["Scope", args.meta.scopeLabel],
    ["Hide non-primary artists", args.meta.hideNonPrimary ? "Yes" : "No"],
    ["Collaborator filter", args.meta.collabFilterLabel],
    ["Artists in this export", args.viewNodes.length],
    ["Collaboration links in this export", args.viewEdges.length],
  ];

  const artistsHeader = [
    "artist_id",
    "artist_name",
    "track_count",
    "collaborators_full_graph",
    "collaborators_in_view",
    "collaborator_names",
  ];
  const artistsAoa: Array<Array<string | number>> = [
    artistsHeader,
    ...args.viewNodes.map((n) => {
      const full = args.fullCollabCountById.get(n.id) ?? 0;
      const inv = degreeInView(n.id, args.viewEdges);
      const nb = neighborIdsByArtist.get(n.id);
      const collabNames = nb
        ? [...nb]
            .map((id) => args.fullArtistNameById.get(id) ?? id)
            .sort((a, b) => a.localeCompare(b))
        : [];
      const collaboratorNames = joinCellListForSpreadsheet(collabNames);
      return [n.id, n.name, n.track_count, full, inv, collaboratorNames];
    }),
  ];

  const edgesHeader = [
    "source_artist_id",
    "source_name",
    "target_artist_id",
    "target_name",
    "shared_track_count",
  ];
  const edgesAoa: Array<Array<string | number>> = [
    edgesHeader,
    ...normEdges.map((e) => {
      const sn = nodeById.get(e.source)?.name ?? e.source;
      const tn = nodeById.get(e.target)?.name ?? e.target;
      return [e.source, sn, e.target, tn, e.weight];
    }),
  ];

  const tracksHeader = [
    "source_artist_id",
    "source_name",
    "target_artist_id",
    "target_name",
    "isrc",
    "track_name",
    "artists_on_track",
    "total_streams",
    "daily_streams",
    "release_date",
    "distro_playlists",
  ];
  const tracksAoa: Array<Array<string | number>> = [tracksHeader];
  const enrich = args.trackEnrichment;
  for (const e of normEdges) {
    const list = e.shared_tracks ?? [];
    const sn = nodeById.get(e.source)?.name ?? e.source;
    const tn = nodeById.get(e.target)?.name ?? e.target;
    for (const t of list) {
      const row = enrich?.get(t.isrc);
      tracksAoa.push([
        e.source,
        sn,
        e.target,
        tn,
        t.isrc,
        row?.catalogName ?? t.name ?? "",
        row?.artistsOnTrack ?? "",
        row?.totalStreams ?? "",
        row?.dailyStreams ?? "",
        row?.releaseDate ?? "",
        row?.distroPlaylists ?? "",
      ]);
    }
  }

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  const wsArtists = XLSX.utils.aoa_to_sheet(artistsAoa);
  wsArtists["!cols"] = [
    { wch: 24 },
    { wch: 28 },
    { wch: 12 },
    { wch: 22 },
    { wch: 22 },
    { wch: 56 },
  ];
  const wsEdges = XLSX.utils.aoa_to_sheet(edgesAoa);
  wsEdges["!cols"] = [{ wch: 26 }, { wch: 28 }, { wch: 26 }, { wch: 28 }, { wch: 18 }];
  const wsTracks = XLSX.utils.aoa_to_sheet(tracksAoa);
  const releaseDateCol = tracksHeader.indexOf("release_date");
  if (releaseDateCol >= 0 && tracksAoa.length > 1) {
    formatReleaseDateColumnAsExcelDates(wsTracks, XLSX.utils, releaseDateCol, tracksAoa.length - 1);
  }
  wsTracks["!cols"] = [
    { wch: 24 },
    { wch: 26 },
    { wch: 24 },
    { wch: 26 },
    { wch: 14 },
    { wch: 36 },
    { wch: 48 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, sanitizeSheetName("Summary"));
  XLSX.utils.book_append_sheet(wb, wsArtists, sanitizeSheetName("Artists"));
  XLSX.utils.book_append_sheet(wb, wsEdges, sanitizeSheetName("Collaborations"));
  XLSX.utils.book_append_sheet(wb, wsTracks, sanitizeSheetName("Tracks"));

  const safeBase = args.filenameBase.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  XLSX.writeFile(wb, `${safeBase || "network_export"}.xlsx`);
}
