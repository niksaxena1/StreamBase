import { logError } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { catalogConfigured, catalogService } from "@/lib/supabase/catalogService";

import { LIBRARY_STREAMS_CACHE_TAG, LIBRARY_STREAMS_CACHE_TTL_S } from "./cache";
import { fetchAllPages } from "./paging";
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
        // PostgREST returns at most 1,000 rows per request, so read the list page by page in a stable order.
        const db = catalogService();
        const all = await fetchAllPages<RawRow>(async (from, to) => {
          const { data, error } = await db.schema("catalog").rpc("track_streams").order("catalog_id", { ascending: true }).range(from, to);
          return { data: (data as RawRow[] | null) ?? null, error };
        });
        return { data: all, error: null };
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

/** How long the page waits for streams before it renders without them. */
export const STREAMS_DEADLINE_MS = 3000;

/**
 * Streams, but never later than `deadlineMs`. If the load is slow the page renders without them
 * (the load keeps going and fills the cache for the next visit). `unavailable` is true when the
 * list is empty because of a timeout or failure.
 */
export async function loadLibraryStreamsWithin(
  deadlineMs: number = STREAMS_DEADLINE_MS,
  load: () => Promise<LibraryStream[]> = loadLibraryStreams,
): Promise<{ streams: LibraryStream[]; unavailable: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    const streams = await Promise.race([load(), timeout]);
    if (streams === null) {
      logError("Library streams timed out", new Error(`no answer after ${deadlineMs} ms`));
      return { streams: [], unavailable: true };
    }
    return { streams, unavailable: streams.length === 0 };
  } finally {
    clearTimeout(timer);
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
