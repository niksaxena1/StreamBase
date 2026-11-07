/** Pure helpers for the per-market Spotify availability UI (no server imports). */

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
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const iso = d.toISOString();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${iso.slice(8, 10)} ${months[d.getUTCMonth()]} ${iso.slice(0, 4)}, ${iso.slice(11, 16)} UTC`;
}
