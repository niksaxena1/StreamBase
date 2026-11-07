import { logError } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

import { LIBRARY_STREAMS_CACHE_TAG, LIBRARY_STREAMS_CACHE_TTL_S } from "./cache";
import type { LibraryTerritoryGap } from "./territories";

/** Same bound as the Health table: only tracks with gaps are ever stored here. */
const MAX_GAP_ROWS = 500;
/** The Library renders without the column rather than wait longer than this. */
export const TERRITORY_GAPS_DEADLINE_MS = 2000;

type GapRow = { isrc: string; unavailable_markets: string[] | null };

/**
 * Library "Territories" column data: the tracks that have territory gaps, one bounded read of
 * `spotify_track_market_availability` (primary key = ISRC) cached for an hour. The Library joins it to
 * its rows by ISRC on the client, so the overview query itself is untouched. Never throws.
 */
export async function loadLibraryTerritoryGaps(): Promise<LibraryTerritoryGap[]> {
  try {
    const res = await cachedQuery<LibraryTerritoryGap[]>(
      async () => {
        const { data, error } = await supabaseService()
          .from("spotify_track_market_availability")
          .select("isrc,unavailable_markets")
          .not("unavailable_markets", "eq", "{}")
          .order("isrc", { ascending: true })
          .limit(MAX_GAP_ROWS);
        if (error) return { data: null, error: { message: error.message, code: error.code } };
        const gaps = ((data ?? []) as GapRow[])
          .filter((r) => (r.unavailable_markets ?? []).length > 0)
          .map((r) => ({ isrc: r.isrc, markets: r.unavailable_markets ?? [] }));
        return { data: gaps, error: null };
      },
      "library-territory-gaps-v1",
      LIBRARY_STREAMS_CACHE_TTL_S,
      [LIBRARY_STREAMS_CACHE_TAG],
    );
    if (res.error) {
      logError("Library territory gaps load failed", new Error(res.error.message));
      return [];
    }
    return res.data ?? [];
  } catch (error) {
    logError("Library territory gaps load failed", error);
    return [];
  }
}

/** Territory gaps, but never later than `deadlineMs` (then the column stays empty for this visit). */
export async function loadLibraryTerritoryGapsWithin(
  deadlineMs: number = TERRITORY_GAPS_DEADLINE_MS,
  load: () => Promise<LibraryTerritoryGap[]> = loadLibraryTerritoryGaps,
): Promise<LibraryTerritoryGap[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    const gaps = await Promise.race([load(), timeout]);
    return gaps ?? [];
  } finally {
    clearTimeout(timer);
  }
}
