export type CompetitorHealthKpiFilter =
  | "all"
  | "failed"
  | "stale"
  | "mismatch"
  | "missing"
  | "no_export"
  | "unenriched";

export type CompetitorPipelineStageStatus = "ok" | "warn" | "error" | "pending";

export type CompetitorPipelineStage = {
  id: string;
  label: string;
  status: CompetitorPipelineStageStatus;
  detail: string;
};

export type CompetitorPlaylistHealthRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  latest_data_date: string | null;
  track_count: number | null;
  export_rows_count: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count: number;
  track_swing: number | null;
  stale: boolean;
  row_mismatch: boolean;
  missing_export: boolean;
  bad: boolean;
};

export type CompetitorLabelHealthRow = {
  label_key: string;
  display_name: string;
  playlist_count: number;
  distinct_tracks: number | null;
  summed_track_count: number;
  missing_totals: number;
  stale_playlists: number;
  row_mismatches: number;
  missing_exports: number;
};

export type CompetitorConfigDriftRow = {
  playlist_key: string;
  issue: "missing_in_db" | "missing_in_config" | "inactive_in_db";
  label_key: string | null;
  display_name: string | null;
};

export type CompetitorWarningRow = {
  id: number;
  created_at: string;
  playlist_key: string | null;
  playlist_display_name: string | null;
  label_key: string | null;
  label_display_name: string | null;
  severity: string;
  code: string;
  message: string;
  details_json: Record<string, unknown> | null;
};

export type CompetitorRawExportRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  rows_count: number;
  exported_at: string;
  storage_bucket: string | null;
  object_key: string;
  download_href: string | null;
};

export type CompetitorUnenrichedTrack = {
  isrc: string;
  name: string;
  album_image_url: string | null;
  missing_artists: boolean;
  missing_image: boolean;
};

export type CompetitorHealthPageData = {
  selectedDataDate: string | null;
  selectedRunDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
  runOptions: Array<{ run_date: string; data_date: string; status: string }>;
  selectedLabelKey: string | null;
  labelOptions: Array<{ label_key: string; display_name: string }>;
  kpiFilter: CompetitorHealthKpiFilter;
  kpis: {
    failedRuns: number;
    stalePlaylists: number;
    rowMismatches: number;
    missingTotals: number;
    unenrichedTracks: number;
    missingExports: number;
    missingThumbnails: number;
  };
  pipelineStages: CompetitorPipelineStage[];
  labelRows: CompetitorLabelHealthRow[];
  playlistRows: CompetitorPlaylistHealthRow[];
  exports: CompetitorRawExportRow[];
  warnings: {
    rows: CompetitorWarningRow[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
    severityFilter: "all" | "critical" | "warn";
  };
  configDrift: CompetitorConfigDriftRow[];
  unenriched: {
    rows: CompetitorUnenrichedTrack[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  runs: Array<{
    run_date: string;
    data_date: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    logs_url: string | null;
  }>;
};
