/** Client-safe types for the Territories UI (no server imports). */

export type TerritoryDistributor = { key: string; name: string; imageUrl: string | null };

/** Own-catalog track the daily territory scan found unplayable in at least one territory. */
export type SpotifyMarketRestrictedTrack = {
  isrc: string;
  spotify_track_id: string;
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[];
  unavailable_reasons: Record<string, string>;
  last_checked_at: string;
  name: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  /** Distro playlist the track currently belongs to (null when none is known). */
  distributor: TerritoryDistributor | null;
  /** Latest daily streams (last two data dates); null when not available. */
  daily_streams: number | null;
};

/** One detected change for a (track, territory). */
export type SpotifyMarketEvent = {
  isrc: string;
  market: string;
  event: "lost" | "gained";
  reason: string | null;
  detected_at: string;
  name: string | null;
  artist_names: string[] | null;
};

/** Per-track history entry (Catalog modal). */
export type SpotifyTrackMarketEvent = Pick<SpotifyMarketEvent, "market" | "event" | "reason" | "detected_at">;

/** Catalog track the nightly scan is not currently checking, with why. */
export type TerritoryUncheckedTrack = {
  isrc: string;
  name: string | null;
  artist_names: string[] | null;
  /** taken_down = the takedown watch skips it until it is back; not_checked = no territory row yet. */
  reason: "taken_down" | "not_checked";
};

/** Scan coverage over the same catalog the scan works on (public.territory_scan_coverage()). */
export type TerritoryCoverage = {
  catalogTotal: number;
  /** catalogTotal minus every unchecked track. */
  checked: number;
  uncheckedTotal: number;
  /** Capped list (see the RPC); uncheckedTotal is the true count. */
  unchecked: TerritoryUncheckedTrack[];
};

export type SpotifyMarketSnapshot = {
  /** Scan coverage; null when the coverage migration has not been applied yet. */
  coverage: TerritoryCoverage | null;
  /** Tracks with unavailable territories, biggest daily streams first. */
  restricted: SpotifyMarketRestrictedTrack[];
  /** Territory changes in the last 30 days, newest first (max 200). */
  events: SpotifyMarketEvent[];
  /** Most recent scan across all tracks (null before the first run). */
  lastCheckedAt: string | null;
  /** Size of the territory universe in the latest scan. */
  marketsChecked: number | null;
};

/** Takedown watch transition for one track (taken_down / restored). */
export type SpotifyTrackTakedownEvent = {
  event: "taken_down" | "restored";
  reason: string | null;
  detected_at: string;
};

export type SpotifyTrackMarkets = {
  /** False when the track has no territory row yet (only takedown events are known). Default true. */
  scanned?: boolean;
  /** Takedown watch history for this ISRC, newest first. */
  takedown_events?: SpotifyTrackTakedownEvent[];
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[];
  unavailable_reasons?: Record<string, string>;
  last_checked_at?: string | null;
  /** Recent changes for this ISRC, newest first. */
  history?: SpotifyTrackMarketEvent[];
};
