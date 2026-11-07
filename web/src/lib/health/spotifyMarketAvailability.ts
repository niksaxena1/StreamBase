import { CACHE_TTL_1H } from "@/lib/constants";
import { addDaysISO } from "@/lib/sotDates";
import { recentStreamFloor } from "@/lib/streamHistoryBounds";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { sortByDailyStreams } from "./spotifyMarketFormat";
import type {
  SpotifyMarketEvent,
  SpotifyMarketRestrictedTrack,
  SpotifyMarketSnapshot,
  SpotifyTrackMarketEvent,
  SpotifyTrackMarkets,
  TerritoryDistributor,
} from "./spotifyMarketTypes";

export type {
  SpotifyMarketEvent,
  SpotifyMarketRestrictedTrack,
  SpotifyMarketSnapshot,
  SpotifyTrackMarketEvent,
  SpotifyTrackMarkets,
  TerritoryDistributor,
} from "./spotifyMarketTypes";

/** Max restricted tracks read per request (the table only holds tracks with gaps in this view). */
const MAX_RESTRICTED_TRACKS = 500;
/** Recent-changes window and cap. */
const EVENT_WINDOW_DAYS = 30;
const EVENT_LIMIT = 200;
/** Daily-streams read window: the last two data dates are always inside it (SpotOnTrack lags ~2 days). */
const STREAM_WINDOW_DAYS = 7;
/** ISRCs per `.in()` request: 100 x ~8 dates stays under PostgREST's 1000-row cap, and URLs stay short. */
const ISRC_CHUNK = 100;

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

type EventRow = {
  isrc: string;
  market: string;
  event: "lost" | "gained";
  reason: string | null;
  detected_at: string;
  tracks: { name: string | null; spotify_artist_names: string[] | null } | null;
};

function asReasons(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Current distributor per ISRC (membership of a playlist with playlist_type = 'Distro', the same
 * rule Catalog uses). One latest-run lookup, one batched read per 100 ISRCs and one playlist lookup; never throws.
 */
async function fetchDistributors(isrcs: string[]): Promise<Map<string, TerritoryDistributor>> {
  const out = new Map<string, TerritoryDistributor>();
  if (isrcs.length === 0) return out;
  try {
    const svc = supabaseService();
    // Same "active at the latest run" rule as Catalog (valid_from <= run date, valid_to null or >= run date).
    const latestRes = await svc
      .from("playlist_daily_stats")
      .select("date")
      .eq("playlist_key", "all_catalog")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestRunDate = (latestRes.data as { date?: string } | null)?.date ?? null;
    const memberships = await Promise.all(
      chunk(isrcs, ISRC_CHUNK).map((part) => {
        const q = svc.from("playlist_memberships").select("isrc,playlist_key").in("isrc", part);
        return latestRunDate
          ? q.lte("valid_from", latestRunDate).or(`valid_to.is.null,valid_to.gte.${latestRunDate}`)
          : q.is("valid_to", null);
      }),
    );
    const playlistKeySet = new Set<string>();
    for (const res of memberships) {
      if (res.error) return out;
      for (const r of (res.data ?? []) as Array<{ isrc: string; playlist_key: string }>) playlistKeySet.add(r.playlist_key);
    }
    const playlistKeys = [...playlistKeySet];
    if (playlistKeys.length === 0) return out;
    const { data, error } = await svc
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url")
      .in("playlist_key", playlistKeys)
      .eq("playlist_type", "Distro");
    if (error) return out;
    const distro = new Map<string, TerritoryDistributor>();
    for (const p of (data ?? []) as Array<{
      playlist_key: string;
      display_name: string | null;
      spotify_playlist_image_url: string | null;
    }>) {
      distro.set(p.playlist_key, {
        key: p.playlist_key,
        name: p.display_name ?? p.playlist_key,
        imageUrl: p.spotify_playlist_image_url ?? null,
      });
    }
    // A track can sit in several playlists; keep the first membership that is a Distro playlist.
    for (const res of memberships) {
      for (const r of (res.data ?? []) as Array<{ isrc: string; playlist_key: string }>) {
        const d = distro.get(r.playlist_key);
        if (d && !out.has(r.isrc)) out.set(r.isrc, d);
      }
    }
  } catch {
    // Distributor grouping is a nice-to-have; the table still works without it.
  }
  return out;
}

/**
 * Latest daily streams per ISRC = cumulative(latest data date) - cumulative(day before). Reads only
 * the last STREAM_WINDOW_DAYS days of the effective view for the given ISRCs (never unbounded
 * history, see AGENTS.md); never throws.
 */
async function fetchLatestDailyStreams(isrcs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (isrcs.length === 0) return out;
  try {
    const svc = supabaseService();
    const floor = recentStreamFloor(new Date(), STREAM_WINDOW_DAYS);
    const pages = await Promise.all(
      chunk(isrcs, ISRC_CHUNK).map((part) =>
        svc
          .from("track_daily_streams_effective_public")
          .select("date,isrc,streams_cumulative")
          .in("isrc", part)
          .gte("date", floor),
      ),
    );
    const rows: Array<{ date: string; isrc: string; streams_cumulative: number | null }> = [];
    for (const res of pages) {
      if (res.error) return out;
      rows.push(...((res.data ?? []) as typeof rows));
    }
    // The newest data date is often a carry-forward (cumulative unchanged while the source lags),
    // so per ISRC use the most recent consecutive-day pair whose cumulative actually moved.
    const byIsrc = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.streams_cumulative == null) continue;
      let m = byIsrc.get(r.isrc);
      if (!m) byIsrc.set(r.isrc, (m = new Map()));
      m.set(r.date, Number(r.streams_cumulative));
    }
    for (const [isrc, cumByDate] of byIsrc) {
      const dates = [...cumByDate.keys()].sort().reverse();
      let sawPair = false;
      for (const d of dates) {
        const prev = cumByDate.get(addDaysISO(d, -1));
        const cum = cumByDate.get(d)!;
        if (prev == null || cum < prev) continue;
        sawPair = true;
        if (cum > prev) {
          out.set(isrc, cum - prev);
          break;
        }
      }
      if (sawPair && !out.has(isrc)) out.set(isrc, 0);
    }
  } catch {
    // Streams only affect ordering; fall back to scan order.
  }
  return out;
}

/** Territory changes of the last EVENT_WINDOW_DAYS days (newest first, max EVENT_LIMIT); never throws. */
async function fetchRecentEvents(): Promise<SpotifyMarketEvent[]> {
  try {
    const since = new Date(Date.now() - EVENT_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabaseService()
      .from("spotify_track_market_events")
      .select("isrc,market,event,reason,detected_at,tracks(name,spotify_artist_names)")
      .gte("detected_at", since)
      .order("detected_at", { ascending: false })
      .limit(EVENT_LIMIT);
    if (error) return [];
    return ((data ?? []) as unknown as EventRow[]).map((e) => ({
      isrc: e.isrc,
      market: e.market,
      event: e.event,
      reason: e.reason,
      detected_at: e.detected_at,
      name: e.tracks?.name ?? null,
      artist_names: e.tracks?.spotify_artist_names ?? null,
    }));
  } catch {
    return [];
  }
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
      .limit(MAX_RESTRICTED_TRACKS),
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
  const isrcs = rows.map((r) => r.isrc);
  const [distributors, daily, events] = await Promise.all([
    fetchDistributors(isrcs),
    fetchLatestDailyStreams(isrcs),
    fetchRecentEvents(),
  ]);

  const latest = latestRes.data?.[0] as { last_checked_at?: string; markets_checked?: number } | undefined;
  const restricted: SpotifyMarketRestrictedTrack[] = rows.map((r) => ({
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
    distributor: distributors.get(r.isrc) ?? null,
    daily_streams: daily.get(r.isrc) ?? null,
  }));
  return {
    restricted: sortByDailyStreams(restricted),
    events,
    lastCheckedAt: latest?.last_checked_at ?? null,
    marketsChecked: latest?.markets_checked ?? null,
  };
}

export async function cachedSpotifyMarketAvailability() {
  return cachedQuery(
    async () => ({ data: await fetchSpotifyMarketAvailability(), error: null }),
    "health-spotify-market-availability-v5",
    CACHE_TTL_1H,
  );
}

/** Single primary-key lookup (+ its recent events) for the catalog's selected track. Null if never scanned. */
async function fetchSpotifyMarketsForIsrc(isrc: string): Promise<SpotifyTrackMarkets | null> {
  const svc = supabaseService();
  const [rowRes, historyRes] = await Promise.all([
    svc
      .from("spotify_track_market_availability")
      .select("markets_checked,available_count,unavailable_markets,unavailable_reasons,last_checked_at")
      .eq("isrc", isrc)
      .maybeSingle(),
    svc
      .from("spotify_track_market_events")
      .select("market,event,reason,detected_at")
      .eq("isrc", isrc)
      .order("detected_at", { ascending: false })
      .limit(50),
  ]);
  if (rowRes.error || !rowRes.data) return null;
  const row = rowRes.data as {
    markets_checked: number;
    available_count: number;
    unavailable_markets: string[] | null;
    unavailable_reasons: unknown;
    last_checked_at: string | null;
  };
  const history: SpotifyTrackMarketEvent[] = historyRes.error
    ? []
    : ((historyRes.data ?? []) as SpotifyTrackMarketEvent[]).map((e) => ({
        market: e.market,
        event: e.event,
        reason: e.reason,
        detected_at: e.detected_at,
      }));
  return {
    markets_checked: row.markets_checked,
    available_count: row.available_count,
    unavailable_markets: row.unavailable_markets ?? [],
    unavailable_reasons: asReasons(row.unavailable_reasons),
    last_checked_at: row.last_checked_at,
    history,
  };
}

export async function cachedSpotifyMarketsForIsrc(isrc: string) {
  return cachedQuery(
    async () => ({ data: await fetchSpotifyMarketsForIsrc(isrc), error: null }),
    `spotify-markets-isrc-v3-${isrc}`,
    CACHE_TTL_1H,
  );
}
