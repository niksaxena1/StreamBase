import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

/** Own-catalog track the daily Spotify takedown watch found unplayable. */
export type SpotifyUnavailableTrack = {
  isrc: string;
  spotify_track_id: string;
  reason: string | null;
  unavailable_since: string | null;
  last_checked_at: string;
  name: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
};

export type SpotifyAvailabilitySnapshot = {
  unavailable: SpotifyUnavailableTrack[];
  /** Most recent check across all tracks (null before the first run). */
  lastCheckedAt: string | null;
};

type AvailabilityRow = {
  isrc: string;
  spotify_track_id: string;
  reason: string | null;
  unavailable_since: string | null;
  last_checked_at: string;
  tracks: {
    name: string | null;
    spotify_artist_names: string[] | null;
    spotify_artist_ids: string[] | null;
    spotify_album_image_url: string | null;
  } | null;
};

/**
 * Reads `spotify_track_availability` (written by
 * scripts/check_spotify_track_availability.py). Returns null when the
 * migration has not been applied yet so the Health section simply hides.
 */
async function fetchSpotifyAvailability(): Promise<SpotifyAvailabilitySnapshot | null> {
  const svc = supabaseService();
  const [unavailableRes, latestRes] = await Promise.all([
    svc
      .from("spotify_track_availability")
      .select(
        "isrc,spotify_track_id,reason,unavailable_since,last_checked_at,tracks(name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url)",
      )
      .eq("status", "unavailable")
      .order("unavailable_since", { ascending: false })
      .limit(500),
    svc
      .from("spotify_track_availability")
      .select("last_checked_at")
      .order("last_checked_at", { ascending: false })
      .limit(1),
  ]);
  if (unavailableRes.error || latestRes.error) return null;

  const rows = (unavailableRes.data ?? []) as unknown as AvailabilityRow[];
  return {
    unavailable: rows.map((r) => ({
      isrc: r.isrc,
      spotify_track_id: r.spotify_track_id,
      reason: r.reason,
      unavailable_since: r.unavailable_since,
      last_checked_at: r.last_checked_at,
      name: r.tracks?.name ?? null,
      artist_names: r.tracks?.spotify_artist_names ?? null,
      artist_ids: r.tracks?.spotify_artist_ids ?? null,
      album_image_url: r.tracks?.spotify_album_image_url ?? null,
    })),
    lastCheckedAt: (latestRes.data?.[0] as { last_checked_at?: string } | undefined)?.last_checked_at ?? null,
  };
}

export async function cachedSpotifyAvailability() {
  return cachedQuery(
    async () => ({ data: await fetchSpotifyAvailability(), error: null }),
    "health-spotify-availability-v1",
    CACHE_TTL_1H,
  );
}

/** Human label for the checker's reason codes. */
export function describeUnavailableReason(reason: string | null): string {
  if (!reason) return "Unavailable";
  if (reason === "not_found") return "Removed (404)";
  if (reason === "isrc_search_miss") return "Not found by ISRC";
  if (reason === "no_markets") return "No markets";
  if (reason.startsWith("not_playable")) {
    const detail = reason.split(":")[1];
    return detail ? `Not playable (${detail})` : "Not playable";
  }
  return reason;
}
