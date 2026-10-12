import { logError } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { catalogConfigured, catalogService } from "@/lib/supabase/catalogService";

import { LIBRARY_STREAMS_CACHE_TAG, LIBRARY_STREAMS_CACHE_TTL_S } from "./cache";
import { normalizeStream, normalizeStreamPoint } from "./streams";
import type { LibraryStream, LibraryStreamPoint } from "./types";

type RawRow = Record<string, unknown>;

/**
 * Stream totals for every release with an ISRC. Streams change once a day, so this is cached on its
 * own for an hour. It never throws: if the call fails the page just shows "—" in the stream columns.
 */
export async function loadLibraryStreams(): Promise<LibraryStream[]> {
  if (!catalogConfigured()) return [];
  try {
    const res = await cachedQuery<RawRow[]>(
      async () => {
        const { data, error } = await catalogService().schema("catalog").rpc("track_streams");
        return { data: (data as RawRow[] | null) ?? null, error: error ? { message: error.message, code: error.code } : null };
      },
      "library-streams",
      LIBRARY_STREAMS_CACHE_TTL_S,
      [LIBRARY_STREAMS_CACHE_TAG],
    );
    if (res.error) {
      logError("Library streams load failed", new Error(res.error.message));
      return [];
    }
    return (res.data ?? []).map(normalizeStream).filter((s) => s.catalog_id);
  } catch (error) {
    logError("Library streams load failed", error);
    return [];
  }
}

/** Daily cumulative streams for one release (read fresh when the detail panel asks for it). */
export async function loadLibraryStreamSeries(catalogId: string, days: number): Promise<LibraryStreamPoint[]> {
  const { data, error } = await catalogService()
    .schema("catalog")
    .rpc("track_stream_series", { p_catalog_id: catalogId, p_days: days });
  if (error) throw new Error(error.message);
  return ((data as RawRow[] | null) ?? []).map(normalizeStreamPoint).filter((p): p is LibraryStreamPoint => p !== null);
}
