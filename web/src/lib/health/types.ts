// ---------------------------------------------------------------------------
// Shared health types — used across data-fetching, server components, and
// the WarningRow client component.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeKey(key: string | null | undefined): string {
  return String(key ?? "").trim();
}

export function normalizeIsrc(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Track types
// ---------------------------------------------------------------------------

export type TrackBase = {
  isrc: string;
  name: string | null;
  spotify_track_id?: string | null;
  artist_names?: string[] | null;
  artist_ids?: string[] | null;
  album_image_url?: string | null;
};

export type StaleTrack = TrackBase & {
  streams_cumulative?: number | null;
  avg_daily_7d?: number | null;
};

export type DecreasedTrack = TrackBase & {
  prev_streams?: number | null;
  today_streams?: number | null;
  delta?: number | null;
};

export type RemovedTrack = TrackBase & {
  prev_streams?: number | null;
};

export type PrevNonzeroTrack = TrackBase & {
  prev_streams_cumulative?: number | null;
};

export type ExcludedZeroedTrack = TrackBase & {
  prev_streams?: number | null;
};

export type NegativeDailyStreamTrack = TrackBase & {
  daily_streams_delta?: number | null;
  total_streams_cumulative?: number | null;
};

export type ArtificialStreamTrack = TrackBase & {
  daily_today?: number | null;
  avg_same_dow?: number | null;
  spike_ratio?: number | null;
  streams_cumulative?: number | null;
};

export type DriftTrack = TrackBase & {
  source_playlist_key?: string | null;
};

export type OverlapTrack = TrackBase & {
  distro_playlist_keys: string[];
};

export type MissingCatalogTrack = {
  isrc: string;
  name: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  playlists: string[];
};

export type SwingTracks = {
  added: TrackBase[];
  removed: TrackBase[];
};

export type DriftData = {
  extra: DriftTrack[];
  missing: TrackBase[];
};

export type PlaylistMeta = {
  name: string;
  imageUrl: string | null;
};

// ---------------------------------------------------------------------------
// WarningRow — the shape coming out of activeWarnings.ts
// ---------------------------------------------------------------------------

export type WarningRow = {
  severity: string;
  code: string;
  playlist_key: string | null;
  message: string;
  run_date: string;
  details_json: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Type-safe details_json schemas (one per warning code)
// ---------------------------------------------------------------------------

export type MissingEnrichmentDetailsJson = {
  isrc_list?: string[];
  missing_enrichment_track_count?: number;
  note?: string;
};

export type CatalogMissingSnapshotsDetailsJson = {
  missing_isrcs_sample?: string[];
  note?: string;
};

export type PrevNonzeroDetailsJson = {
  affected_isrcs_with_prev_sample?: {
    isrc: string;
    prev_streams_cumulative: number;
  }[];
  note?: string;
};

export type IndividualTracksStaleDetailsJson = {
  affected_tracks?: { isrc: string; streams_cumulative: number }[];
  note?: string;
};

export type ExcludedTrackZeroedDetailsJson = {
  affected_tracks?: { isrc: string; prev_streams: number }[];
  note?: string;
};

export type TotalStreamsDecreasedDetailsJson = {
  decreased_tracks?: {
    isrc: string;
    prev_streams: number;
    today_streams: number;
    delta: number;
  }[];
  delta?: number;
  prev_total_streams_cumulative?: number;
  today_total_streams_cumulative?: number;
  decreased_tracks_total?: number;
  removed_tracks?: {
    isrc: string;
    prev_streams: number;
  }[];
  removed_tracks_total?: number;
  removed_streams_total?: number;
  note?: string;
};

export type ArtificialStreamSpikeDetailsJson = {
  flagged_tracks?: {
    isrc: string;
    daily_today?: number;
    avg_same_dow?: number;
    spike_ratio?: number;
    streams_cumulative?: number;
  }[];
  flagged_tracks_total?: number;
  threshold_config?: Record<string, unknown>;
  note?: string;
};

// ---------------------------------------------------------------------------
// Discriminated union for expanded data passed to WarningRow
// ---------------------------------------------------------------------------

export type WarningExpandedData =
  | { type: "non_catalog_tracks_present"; tracks: TrackBase[] }
  | { type: "track_count_swing"; swing: SwingTracks }
  | {
      type: "tracks_missing_enrichment";
      tracks: TrackBase[] | null;
      note?: string;
    }
  | {
      type: "catalog_missing_stream_snapshots";
      tracks: TrackBase[] | null;
      note?: string;
    }
  | {
      type: "catalog_streams_missing_prev_nonzero";
      tracks: PrevNonzeroTrack[] | null;
      note?: string;
    }
  | {
      type: "individual_tracks_stale";
      tracks: StaleTrack[] | null;
      note?: string;
    }
  | {
      type: "excluded_track_streams_zeroed";
      tracks: ExcludedZeroedTrack[] | null;
      note?: string;
    }
  | {
      type: "total_streams_decreased";
      tracks: DecreasedTrack[] | null;
      removedTracks: RemovedTrack[] | null;
      removedStreamsTotal: number;
      note?: string;
    }
  | { type: "entity_distro_drift"; drift: DriftData }
  | { type: "distro_overlap"; tracks: OverlapTrack[] | null; note?: string }
  | {
      type: "negative_daily_streams";
      tracks: NegativeDailyStreamTrack[] | null;
      note?: string;
    }
  | {
      type: "artificial_stream_spike";
      tracks: ArtificialStreamTrack[] | null;
      note?: string;
    }
  | null;

// ---------------------------------------------------------------------------
// DisplayedWarning — the fully resolved warning for the UI
// ---------------------------------------------------------------------------

export type DisplayedWarning = {
  severity: string;
  code: string;
  playlist_key: string | null;
  message: string;
  run_date: string;
  playlistMeta: PlaylistMeta | null;
  expandedData: WarningExpandedData;
  resolutionStatus?: "active" | "resolved";
};
