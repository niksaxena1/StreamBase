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
