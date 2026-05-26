export type LabelRow = {
  label_key: string;
  display_name: string;
  is_active: boolean;
  accent_hex: string | null;
};

export type PlaylistRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  sot_dashboard_url: string;
  display_order: number | null;
  is_active: boolean;
};

export type LabelDailyPoint = {
  date: string;
  label_key: string;
  daily_streams_net: number;
  total_streams_cumulative: number;
  track_count: number;
};

export type ComparisonMode = "combined" | "individual" | "percentage";

export type LabelComparisonRow = {
  label: LabelRow;
  playlistCount: number;
  trackCount: number;
  artistCount: number;
  dailyStreams: number;
  dailyMa7: number | null;
  dailyYesterday: number | null;
  trackDelta: number | null;
  trackWeeklyDelta: number | null;
  artistDelta: number | null;
  artistWeeklyDelta: number | null;
  dailyStreamDelta: number | null;
  sparkline: number[];
};

export type MoverTrackRow = {
  isrc: string;
  name: string;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  label_keys: string[];
  daily_delta: number;
  total: number;
};

export type ChurnRow = {
  label_key: string;
  added_count: number;
  removed_count: number;
  net: number;
  track_count_delta_7d: number | null;
};

export type OverlapCell = {
  label_a: string;
  label_b: string;
  shared_isrcs: number;
  label_a_total: number;
  label_b_total: number;
  jaccard: number;
};

export const COMPETITORS_COMPARISON_STORAGE = {
  labels: "sb:competitors:comparison:labels",
  mode: "sb:competitors:comparison:mode",
} as const;

export type MoverFilter = "all" | "shared" | "exclusive";
