import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

/** Own-catalog track the weekly market scan found unplayable in at least one market. */
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
};

export type SpotifyMarketSnapshot = {
  /** Tracks with unavailable markets, most markets missing first. */
  restricted: SpotifyMarketRestrictedTrack[];
  /** Most recent scan across all tracks (null before the first run). */
  lastCheckedAt: string | null;
  /** Size of the market universe in the latest scan. */
  marketsChecked: number | null;
};

export type SpotifyTrackMarkets = {
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[];
  unavailable_reasons?: Record<string, string>;
  last_checked_at?: string | null;
};

type MarketRow = {
  isrc: string;
  spotify_track_id: string;
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[] | null;
  unavailable_reasons: unknown;
  last_checked_at: string;
  tracks: {
    name: string | null;
    spotify_artist_names: string[] | null;
    spotify_artist_ids: string[] | null;
    spotify_album_image_url: string | null;
  } | null;
};

function asReasons(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

/**
 * Reads `spotify_track_market_availability` (written by
 * scripts/scan_spotify_market_availability.py). Returns null when the
 * migration has not been applied yet so the UI simply hides.
 */
async function fetchSpotifyMarketAvailability(): Promise<SpotifyMarketSnapshot | null> {
  const svc = supabaseService();
  const [restrictedRes, latestRes] = await Promise.all([
    svc
      .from("spotify_track_market_availability")
      .select(
        "isrc,spotify_track_id,markets_checked,available_count,unavailable_markets,unavailable_reasons,last_checked_at,tracks(name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url)",
      )
      .not("unavailable_markets", "eq", "{}")
      .order("available_count", { ascending: true })
      .limit(500),
    svc
      .from("spotify_track_market_availability")
      .select("last_checked_at,markets_checked")
      .order("last_checked_at", { ascending: false })
      .limit(1),
  ]);
  if (restrictedRes.error || latestRes.error) return null;

  const rows = ((restrictedRes.data ?? []) as unknown as MarketRow[]).filter(
    (r) => (r.unavailable_markets ?? []).length > 0,
  );
  const latest = latestRes.data?.[0] as { last_checked_at?: string; markets_checked?: number } | undefined;
  const restricted = rows
    .map((r) => ({
      isrc: r.isrc,
      spotify_track_id: r.spotify_track_id,
      markets_checked: r.markets_checked,
      available_count: r.available_count,
      unavailable_markets: r.unavailable_markets ?? [],
      unavailable_reasons: asReasons(r.unavailable_reasons),
      last_checked_at: r.last_checked_at,
      name: r.tracks?.name ?? null,
      artist_names: r.tracks?.spotify_artist_names ?? null,
      artist_ids: r.tracks?.spotify_artist_ids ?? null,
      album_image_url: r.tracks?.spotify_album_image_url ?? null,
    }))
    .sort((a, b) => b.unavailable_markets.length - a.unavailable_markets.length);
  return {
    restricted,
    lastCheckedAt: latest?.last_checked_at ?? null,
    marketsChecked: latest?.markets_checked ?? null,
  };
}

export async function cachedSpotifyMarketAvailability() {
  return cachedQuery(
    async () => ({ data: await fetchSpotifyMarketAvailability(), error: null }),
    "health-spotify-market-availability-v1",
    CACHE_TTL_1H,
  );
}

/** Single primary-key lookup for the catalog's selected track. Null if never scanned. */
async function fetchSpotifyMarketsForIsrc(isrc: string): Promise<SpotifyTrackMarkets | null> {
  const { data, error } = await supabaseService()
    .from("spotify_track_market_availability")
    .select("markets_checked,available_count,unavailable_markets,unavailable_reasons,last_checked_at")
    .eq("isrc", isrc)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    markets_checked: number;
    available_count: number;
    unavailable_markets: string[] | null;
    unavailable_reasons: unknown;
    last_checked_at: string | null;
  };
  return {
    markets_checked: row.markets_checked,
    available_count: row.available_count,
    unavailable_markets: row.unavailable_markets ?? [],
    unavailable_reasons: asReasons(row.unavailable_reasons),
    last_checked_at: row.last_checked_at,
  };
}

export async function cachedSpotifyMarketsForIsrc(isrc: string) {
  return cachedQuery(
    async () => ({ data: await fetchSpotifyMarketsForIsrc(isrc), error: null }),
    `spotify-markets-isrc-v2-${isrc}`,
    CACHE_TTL_1H,
  );
}
