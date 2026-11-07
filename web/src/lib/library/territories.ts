import { sortTerritories } from "@/lib/health/spotifyMarketFormat";

import type { LibraryRow } from "./types";

/** Territory gaps of one ISRC: the territories its Spotify track is not playable in (never empty). */
export type LibraryTerritoryGap = { isrc: string; markets: string[] };

export type TerritoryGapsFilter = "" | "any" | "none";

export function parseTerritoryGapsFilter(value: string | null | undefined): TerritoryGapsFilter {
  return value === "any" || value === "none" ? value : "";
}

const normIsrc = (isrc: string | null | undefined) => (isrc ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Puts the missing territories on each row whose ISRC has a gap. Rows without a gap (live everywhere,
 * never scanned, or no ISRC) are left untouched, so "unknown" and "fine" both show nothing.
 */
export function mergeTerritoryGaps(rows: LibraryRow[], gaps: LibraryTerritoryGap[]): LibraryRow[] {
  if (gaps.length === 0) return rows;
  const byIsrc = new Map(gaps.map((g) => [normIsrc(g.isrc), g.markets]));
  return rows.map((row) => {
    const markets = row.isrc ? byIsrc.get(normIsrc(row.isrc)) : undefined;
    return markets && markets.length > 0 ? { ...row, territory_gaps: sortTerritories(markets) } : row;
  });
}

/** "any": the row has territory gaps. "none": it has none (live everywhere or not checked). */
export function matchesTerritoryGaps(row: Pick<LibraryRow, "territory_gaps">, filter: TerritoryGapsFilter): boolean {
  if (!filter) return true;
  const has = (row.territory_gaps?.length ?? 0) > 0;
  return filter === "any" ? has : !has;
}

/** "−4" (true minus sign) for the Library chip. */
export function territoryGapLabel(markets: readonly string[]): string {
  return `\u2212${markets.length}`;
}

/** Tooltip text: the missing territory codes. */
export function territoryGapTitle(markets: readonly string[]): string {
  return `Not playable in ${markets.length} ${markets.length === 1 ? "territory" : "territories"}: ${markets.join(", ")}`;
}
