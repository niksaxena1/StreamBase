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
