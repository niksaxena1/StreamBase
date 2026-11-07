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

export type SpotifyMarketSnapshot = {
  /** Tracks with unavailable territories, biggest daily streams first. */
  restricted: SpotifyMarketRestrictedTrack[];
  /** Territory changes in the last 30 days, newest first (max 200). */
  events: SpotifyMarketEvent[];
  /** Most recent scan across all tracks (null before the first run). */
  lastCheckedAt: string | null;
  /** Size of the territory universe in the latest scan. */
  marketsChecked: number | null;
};

export type SpotifyTrackMarkets = {
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[];
  unavailable_reasons?: Record<string, string>;
  last_checked_at?: string | null;
  /** Recent changes for this ISRC, newest first. */
  history?: SpotifyTrackMarketEvent[];
};
