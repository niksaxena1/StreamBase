import type { NetworkScopeState } from "./networkScope";

/** What “co-artist count” means for the filter + export. */
export type CollabCountBasis = "playlist" | "primary_rows";

/** Visible-artists table sort (URL: `tbl_sort`, `tbl_dir`). */
export type NetworkTableSortKey =
  | "name"
  | "track_count"
  | "co"
  | "deg"
  | "streams_total"
  | "streams_daily";

/** URL-synced view state accepted by `pushNetworkUrl`; omitted fields keep their current value. */
export type NetworkUrlPatch = Partial<{
  scope: NetworkScopeState;
  hideNonPrimary: boolean;
  scaleByTracks: boolean;
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
}>;
