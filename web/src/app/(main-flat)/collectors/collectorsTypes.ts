import type { Granularity } from "@/components/ui/GranularitySelect";

export type Metric = "streams" | "revenue" | "tracks";

export const COLLECTOR_ORDER = ["A", "K", "N", "PL", "TG", "NL"] as const;

export const GRANULARITIES: readonly Granularity[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export const COLLECTORS_DETAILS_STORAGE = {
  playlistsOpen: "sb:collectors:details:playlists_open",
  tracksOpen: "sb:collectors:details:tracks_open",
} as const;

export const COLLECTORS_COMPARISON_STORAGE = {
  collectors: "sb:collectors:comparison:collectors",
  mode: "sb:collectors:comparison:mode",
  granularity: "sb:collectors:comparison:granularity",
} as const;

export const COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE = {
  visible: "sb:collectors:monthly:actual_revenue_visible",
} as const;

export const DRILL_PAGE_SIZE = 200;

export type DrillPlaylistItem = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  playlist_type: string | null;
  track_count: number;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};

export type DrillArtistItem = {
  artist_id: string;
  name: string | null;
  image_url: string | null;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_delta: number;
};

export type DrillTrackItem = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

export type CollectorSummaryRow = {
  collector: string;
  playlists: number;
  artist_count: number;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_net: number;
  est_revenue_total: number;
  est_revenue_daily_net: number;
  daily_streams_delta_yday: number | null;
  daily_streams_delta_ma7: number | null;
  est_revenue_daily_delta_yday: number | null;
  est_revenue_daily_delta_ma7: number | null;
  track_count_delta_yday: number | null;
  track_count_delta_ma7: number | null;
  spark_rev_daily?: number[];
  spark_streams_daily?: number[];
  spark_tracks?: number[];
};

export type CollectorSeriesPoint = {
  date: string;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_net: number;
  est_revenue_total: number;
  est_revenue_daily_net: number;
};

export type TopPlaylistRow = {
  playlist_key: string;
  display_name: string;
  est_revenue_daily_net: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count: number | null;
};

export type CollectorTrackRow = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  playlist_keys: string[] | null;
  playlist_names: string[] | null;
  distro_playlist_keys: string[] | null;
  distro_playlist_names: string[] | null;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

export type DrillKind = "playlists" | "artists" | "tracks";

export type DateBreakdownTrack = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  daily_streams_delta: number | null;
  total_streams_cumulative: number | null;
};

export type DateBreakdownRosterEntry = DateBreakdownTrack & {
  cumulative_streams: number;
};

export type DateBreakdownCollector = {
  daily_streams: number;
  avg7_streams: number;
  delta_pct: number | null;
  top_tracks: DateBreakdownTrack[];
  roster_additions: DateBreakdownRosterEntry[];
  roster_removals: DateBreakdownRosterEntry[];
  roster_cumulative_impact: number;
};

export function isCollectorKey(c: string): c is (typeof COLLECTOR_ORDER)[number] {
  return (COLLECTOR_ORDER as readonly string[]).includes(c);
}
