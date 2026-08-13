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
  totalStreams: number;
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

export type OverlapTrackRow = {
  isrc: string;
  name: string;
  album_image_url: string | null;
  artist_names: string[] | null;
};

export type OverlapArtistCell = {
  label_a: string;
  label_b: string;
  shared_artists: number;
  label_a_total: number;
  label_b_total: number;
  jaccard: number;
};

export type OverlapArtistRow = {
  artist_id: string;
  artist_name: string;
  image_url: string | null;
};

export type OverlapBasis = "tracks" | "artists";

export const COMPETITORS_COMPARISON_STORAGE = {
  labels: "sb:competitors:comparison:labels",
  mode: "sb:competitors:comparison:mode",
} as const;

export type MoverFilter = "all" | "selected";

export type CompetitorWorkspaceView =
  | "overview"
  | "compare"
  | "movement"
  | "catalog"
  | "health";

export type CompetitorRunRow = {
  run_date: string;
  status: "running" | "success" | "failed" | string;
  started_at: string | null;
  finished_at: string | null;
};

export type CompetitorWarningRow = {
  run_date: string;
  severity: "info" | "warn" | "critical" | string;
  code: string;
  message: string;
  playlist_key: string | null;
};

export type CompetitorOverrideDay = {
  date: string;
  count: number;
};

export type RosterFlowRow = {
  source: string;
  target: string;
  track_count: number;
};

export type RosterMovementRow = {
  isrc: string;
  name: string;
  artist_names: string[] | null;
  album_image_url: string | null;
  source: string;
  target: string;
  event_date: string;
};

export type CompetitorMovementInsights = {
  window_start: string;
  window_end: string;
  flows: RosterFlowRow[];
  movements: RosterMovementRow[];
};

export type ArtistMomentumRow = {
  artist_id: string;
  artist_name: string;
  image_url: string | null;
  label_keys: string[];
  track_count: number;
  daily_streams: number;
  total_streams: number;
  daily_per_track: number;
  total_per_track: number;
};

export type ReleaseCohortRow = {
  release_month: string;
  age_band: string;
  age_band_order: number;
  track_count: number;
  median_daily_streams: number;
  median_total_streams: number;
};

export type CompetitorCatalogInsights = {
  data_date: string;
  artists: ArtistMomentumRow[];
  cohorts: ReleaseCohortRow[];
};
