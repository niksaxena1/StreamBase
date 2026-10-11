import { appendNetworkScopeToSearchParams, type NetworkScopeState } from "./networkScope";
import { MAX_SEL_URL } from "./networkGraphConstants";
import type { CollabCountBasis, NetworkTableSortKey } from "./networkGraphTypes";

export function readNetworkToggles(sp: URLSearchParams) {
  return {
    scaleByTracks: sp.get("scale_tracks") === "1",
    sizeByStreams: sp.get("size_streams") !== "0" && sp.get("scale_tracks") !== "1",
    colourByCluster: sp.get("clusters") === "1",
    highlightRecent: sp.get("recent_collabs") === "1",
    throughDay: parseNetworkThroughDay(sp.get("net_time")),
    showImages: sp.get("images") !== "0",
    tableView: sp.get("table") === "1",
  };
}

export function parseNetworkThroughDay(raw: string | null): number | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const time = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw ? time / 86_400_000 : null;
}

function parseTrackCountBound(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 999999) return null;
  return n;
}

export function parseTrackCountBounds(sp: URLSearchParams): { min: number | null; max: number | null } {
  return {
    min: parseTrackCountBound(sp.get("tc_min")),
    max: parseTrackCountBound(sp.get("tc_max")),
  };
}

export function parseCollabCountBasis(sp: URLSearchParams): CollabCountBasis {
  const v = sp.get("co_basis")?.trim().toLowerCase();
  if (v === "primary" || v === "primary_rows" || v === "lead") return "primary_rows";
  return "playlist";
}

export function parseNetworkTableSort(sp: { get: (k: string) => string | null }): {
  key: NetworkTableSortKey;
  dir: "asc" | "desc";
} {
  const raw = sp.get("tbl_sort");
  const key: NetworkTableSortKey =
    raw === "track_count" ||
    raw === "co" ||
    raw === "deg" ||
    raw === "streams_total" ||
    raw === "streams_daily"
      ? raw
      : "name";
  const dir = sp.get("tbl_dir") === "desc" ? "desc" : "asc";
  return { key, dir };
}

export function appendNetworkTableSortParams(
  p: URLSearchParams,
  key: NetworkTableSortKey,
  dir: "asc" | "desc",
): void {
  p.delete("tbl_sort");
  p.delete("tbl_dir");
  if (key === "name" && dir === "asc") return;
  p.set("tbl_sort", key);
  if (dir === "desc") p.set("tbl_dir", "desc");
}

/** Inclusive co-artist count range from `collab_min` / `collab_max` (0–999 each). */
export function parseCollabRangeBounds(sp: URLSearchParams): { min: number | null; max: number | null } {
  const parseN = (raw: string | null): number | null => {
    if (raw == null || raw === "") return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 999) return null;
    return n;
  };
  let min = parseN(sp.get("collab_min"));
  let max = parseN(sp.get("collab_max"));
  if (min != null && max != null && min > max) {
    [min, max] = [max, min];
  }
  return { min, max };
}

export function collabRangeIsActive(min: number | null, max: number | null): boolean {
  return min != null || max != null;
}

export function coartistCountInRange(cnt: number, min: number | null, max: number | null): boolean {
  if (!collabRangeIsActive(min, max)) return true;
  if (min != null && cnt < min) return false;
  if (max != null && cnt > max) return false;
  return true;
}

export function formatCollabRangeSummary(min: number | null, max: number | null): string {
  if (!collabRangeIsActive(min, max)) return "";
  if (min != null && max != null) {
    return min === max ? `${min}` : `${min}–${max}`;
  }
  if (min != null) return `≥${min}`;
  return `≤${max!}`;
}

/** Non-empty draft must be digits only; clamps to 0–999. */
export function parseCollabInputDraft(trimmed: string): number | null {
  const t = trimmed.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Math.min(999, Math.max(0, n));
}

/** Track-count filter inputs: 0–999999 (graph node `track_count` in scope). */
export function parseTrackCountInputDraft(trimmed: string): number | null {
  const t = trimmed.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Math.min(999999, Math.max(0, n));
}

export function buildNetworkQueryString(args: {
  scope: NetworkScopeState;
  hideNonPrimary: boolean;
  scaleByTracks: boolean;
  sizeByStreams?: boolean;
  colourByCluster?: boolean;
  highlightRecent?: boolean;
  throughDay?: number | null;
  showImages: boolean;
  tableView: boolean;
  collabMin: number | null;
  collabMax: number | null;
  collabCountBasis: CollabCountBasis;
  trackCountMin: number | null;
  trackCountMax: number | null;
  selectedIds: string[];
  tableSortKey: NetworkTableSortKey;
  tableSortDir: "asc" | "desc";
}): string {
  const p = new URLSearchParams();
  appendNetworkScopeToSearchParams(p, args.scope);
  if (args.hideNonPrimary) p.set("hide_non_primary", "1");
  if (args.scaleByTracks) p.set("scale_tracks", "1");
  if (args.sizeByStreams === false) p.set("size_streams", "0");
  if (args.colourByCluster) p.set("clusters", "1");
  if (args.highlightRecent) p.set("recent_collabs", "1");
  if (args.throughDay != null) p.set("net_time", new Date(args.throughDay * 86_400_000).toISOString().slice(0, 10));
  if (!args.showImages) p.set("images", "0");
  if (args.tableView) p.set("table", "1");
  if (args.collabMin != null) p.set("collab_min", String(args.collabMin));
  if (args.collabMax != null) p.set("collab_max", String(args.collabMax));
  if (args.collabCountBasis === "primary_rows") p.set("co_basis", "primary");
  if (args.trackCountMin != null) p.set("tc_min", String(args.trackCountMin));
  if (args.trackCountMax != null) p.set("tc_max", String(args.trackCountMax));
  if (args.selectedIds.length > 0 && args.selectedIds.length <= MAX_SEL_URL) {
    p.set("sel", args.selectedIds.join(","));
  }
  appendNetworkTableSortParams(p, args.tableSortKey, args.tableSortDir);
  const s = p.toString();
  return s ? `?${s}` : "";
}
