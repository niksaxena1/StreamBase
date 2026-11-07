/** Pure helpers for the per-territory Spotify availability UI (no server imports). */

import { formatDisplayDate, formatDisplayDateTimeUtc } from "@/lib/format";
import type {
  SpotifyMarketEvent,
  SpotifyMarketRestrictedTrack,
  TerritoryDistributor,
} from "./spotifyMarketTypes";

const regionNames: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** Full country name for an ISO 3166-1 alpha-2 code ("BR" -> "Brazil"); falls back to the code. */
export function marketName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "179 / 183" */
export function formatMarketCount(availableCount: number, marketsChecked: number): string {
  return `${availableCount} / ${marketsChecked}`;
}

/** Distinct restriction reasons for display ("market" is the common geo-block). */
export function describeMarketReasons(reasons: Record<string, string> | null | undefined): string {
  const distinct = Array.from(new Set(Object.values(reasons ?? {}).filter(Boolean)));
  if (distinct.length === 0) return "—";
  return distinct.map((r) => (r === "none" ? "No reason given" : r === "missing" ? "Missing from API" : r)).join(", ");
}

/** First `max` codes plus how many were left out. */
export function truncateMarkets(markets: string[], max = 12): { shown: string[]; more: number } {
  return { shown: markets.slice(0, max), more: Math.max(0, markets.length - max) };
}

/**
 * One compact catalog line: "Spotify: all 183 markets" or
 * "Spotify: unavailable in BR, IN, MX, PK (179/183)".
 */
export function formatMarketsLine(args: {
  markets_checked: number;
  available_count: number;
  unavailable_markets: string[];
}): string {
  if (args.unavailable_markets.length === 0) return `Spotify: all ${args.markets_checked} markets`;
  const { shown, more } = truncateMarkets(args.unavailable_markets, 12);
  const list = more > 0 ? `${shown.join(", ")} +${more} more` : shown.join(", ");
  return `Spotify: unavailable in ${list} (${args.available_count}/${args.markets_checked})`;
}

/** Plain-English meaning of Spotify's `restrictions.reason` for one market. */
export function marketReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "market":
      return "Not released in this territory";
    case "product":
      return "Premium only";
    case "explicit":
      return "Hidden by explicit-content filter";
    case "missing":
      return "Missing from the Spotify API";
    default:
      return "Not playable (no reason given)";
  }
}

/** Short reason summary for a track: null when every market is the ordinary geo-block. */
export function unusualReasonSummary(reasons: Record<string, string> | null | undefined): string | null {
  const distinct = Array.from(new Set(Object.values(reasons ?? {}).filter(Boolean)));
  if (distinct.length === 0 || (distinct.length === 1 && distinct[0] === "market")) return null;
  return distinct.map((r) => marketReasonLabel(r)).join(" · ");
}

/** How many tracks miss each country, most affected first (ties by country name). */
export function tallyMarkets(tracks: { unavailable_markets: string[] }[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of tracks) for (const code of t.unavailable_markets) counts.set(code, (counts.get(code) ?? 0) + 1);
  return Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) => b.count - a.count || marketName(a.code).localeCompare(marketName(b.code)),
  );
}

/** "07 Nov 2026, 00:03 UTC" (StreamBase display format: DD Mon YYYY). */
export function formatScanTime(ts: string | null | undefined): string {
  if (!ts) return "never";
  const out = formatDisplayDateTimeUtc(ts);
  return out === "—" ? ts : out;
}

/**
 * Large Spotify markets: a gap here costs the most listeners, so these chips are
 * emphasised and always listed first.
 */
export const MAJOR_TERRITORIES: readonly string[] = [
  "US", "GB", "DE", "BR", "MX", "IN", "FR", "CA", "AU", "JP", "ES", "IT", "NL", "SE", "ID", "PH", "PL", "TR",
];

const MAJOR_RANK = new Map(MAJOR_TERRITORIES.map((code, i) => [code, i]));

export function isMajorTerritory(code: string): boolean {
  return MAJOR_RANK.has(code);
}

/** Major territories first (in MAJOR_TERRITORIES order), then the rest by country name. */
export function sortTerritories(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => {
    const ra = MAJOR_RANK.get(a);
    const rb = MAJOR_RANK.get(b);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return marketName(a).localeCompare(marketName(b));
  });
}

/** Biggest daily streams first (unknown last); ties: more territories missing first, then ISRC. */
export function sortByDailyStreams<T extends { daily_streams: number | null; unavailable_markets: string[]; isrc: string }>(
  tracks: readonly T[],
): T[] {
  return [...tracks].sort(
    (a, b) =>
      (b.daily_streams ?? -1) - (a.daily_streams ?? -1) ||
      b.unavailable_markets.length - a.unavailable_markets.length ||
      a.isrc.localeCompare(b.isrc),
  );
}

export const NO_DISTRIBUTOR_KEY = "__none";

export type DistributorGroup<T> = {
  key: string;
  name: string;
  imageUrl: string | null;
  tracks: T[];
  /** Union of missing territories with how many of the group's tracks miss each (major first). */
  territories: { code: string; count: number }[];
  dailyStreams: number;
};

/** One group per distributor, biggest combined daily streams first. Tracks keep their incoming order. */
export function groupByDistributor<
  T extends { distributor: TerritoryDistributor | null; unavailable_markets: string[]; daily_streams: number | null },
>(tracks: readonly T[]): DistributorGroup<T>[] {
  const groups = new Map<string, DistributorGroup<T>>();
  for (const t of tracks) {
    const key = t.distributor?.key ?? NO_DISTRIBUTOR_KEY;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: t.distributor?.name ?? "No distributor found",
        imageUrl: t.distributor?.imageUrl ?? null,
        tracks: [],
        territories: [],
        dailyStreams: 0,
      };
      groups.set(key, g);
    }
    g.tracks.push(t);
    g.dailyStreams += t.daily_streams ?? 0;
  }
  const out = Array.from(groups.values());
  for (const g of out) {
    const counts = new Map<string, number>();
    for (const t of g.tracks) for (const code of t.unavailable_markets) counts.set(code, (counts.get(code) ?? 0) + 1);
    g.territories = sortTerritories(Array.from(counts.keys())).map((code) => ({ code, count: counts.get(code) ?? 0 }));
  }
  return out.sort(
    (a, b) =>
      (a.key === NO_DISTRIBUTOR_KEY ? 1 : 0) - (b.key === NO_DISTRIBUTOR_KEY ? 1 : 0) ||
      b.dailyStreams - a.dailyStreams ||
      b.tracks.length - a.tracks.length ||
      a.name.localeCompare(b.name),
  );
}

/** "12,345" or "—" when the daily number is unknown. */
export function formatDailyStreams(n: number | null | undefined): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

export type TerritoryFilters = {
  /** Track must miss at least one of these (empty = no territory filter). */
  territories: ReadonlySet<string>;
  /** Distributor key, or null for all. */
  distributorKey: string | null;
  /** Free text over artist, title and ISRC. */
  query: string;
};

export function filterRestrictedTracks<T extends SpotifyMarketRestrictedTrack>(
  tracks: readonly T[],
  f: TerritoryFilters,
): T[] {
  const q = f.query.trim().toLowerCase();
  return tracks.filter((t) => {
    if (f.territories.size > 0 && !t.unavailable_markets.some((c) => f.territories.has(c))) return false;
    if (f.distributorKey != null && (t.distributor?.key ?? NO_DISTRIBUTOR_KEY) !== f.distributorKey) return false;
    if (q) {
      const hay = `${(t.artist_names ?? []).join(" ")} ${t.name ?? ""} ${t.isrc}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** "BR=market; IN=none", or just "market" when every territory has the same reason. */
export function csvReasons(reasons: Record<string, string> | null | undefined, markets: readonly string[]): string {
  const pairs = markets.map((m) => [m, reasons?.[m] || "none"] as const);
  const distinct = new Set(pairs.map(([, r]) => r));
  if (distinct.size === 0) return "";
  if (distinct.size === 1) return pairs[0][1];
  return pairs.map(([m, r]) => `${m}=${r}`).join("; ");
}

export const TERRITORY_CSV_HEADERS = [
  "Artist",
  "Title",
  "ISRC",
  "Distributor",
  "Daily streams",
  "Live in",
  "Checked",
  "Missing territories",
  "Reasons",
  "Last checked",
] as const;

/** Rows for downloadCsv (keys = TERRITORY_CSV_HEADERS). Last checked stays ISO inside the CSV. */
export function buildTerritoryCsvRows(tracks: readonly SpotifyMarketRestrictedTrack[]): Record<string, unknown>[] {
  return tracks.map((t) => ({
    Artist: (t.artist_names ?? []).join(", "),
    Title: t.name ?? "",
    ISRC: t.isrc,
    Distributor: t.distributor?.name ?? "",
    "Daily streams": t.daily_streams,
    "Live in": t.available_count,
    Checked: t.markets_checked,
    "Missing territories": sortTerritories(t.unavailable_markets).join(" "),
    Reasons: csvReasons(t.unavailable_reasons, t.unavailable_markets),
    "Last checked": t.last_checked_at,
  }));
}

export type GroupedMarketEvent = {
  /** UTC calendar day (YYYY-MM-DD) the change was detected. */
  day: string;
  isrc: string;
  event: "lost" | "gained";
  markets: string[];
  name: string | null;
  artist_names: string[] | null;
};

/** Merge same-day, same-direction events of one track into one line; newest first. */
export function groupMarketEvents(events: readonly SpotifyMarketEvent[]): GroupedMarketEvent[] {
  const byKey = new Map<string, GroupedMarketEvent>();
  for (const e of events) {
    const day = e.detected_at.slice(0, 10);
    const key = `${day}|${e.isrc}|${e.event}`;
    const g = byKey.get(key);
    if (g) {
      if (!g.markets.includes(e.market)) g.markets.push(e.market);
    } else {
      byKey.set(key, { day, isrc: e.isrc, event: e.event, markets: [e.market], name: e.name, artist_names: e.artist_names });
    }
  }
  return Array.from(byKey.values())
    .map((g) => ({ ...g, markets: sortTerritories(g.markets) }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.isrc.localeCompare(b.isrc) || a.event.localeCompare(b.event));
}

/** "regained" is the user-facing word for the stored `gained` event. */
export function eventVerb(event: "lost" | "gained"): string {
  return event === "lost" ? "lost" : "regained";
}

/** "07 Nov 2026" for a YYYY-MM-DD day. */
export function formatEventDay(day: string): string {
  return formatDisplayDate(day);
}
