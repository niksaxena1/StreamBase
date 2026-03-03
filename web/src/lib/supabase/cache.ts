import { unstable_cache } from "next/cache";
import { logDebug } from "@/lib/logger";
import { CACHE_TTL_24H, SB_TIMING_SLOW_MS_DEFAULT } from "@/lib/constants";

const DEFAULT_REVALIDATE_SECONDS = CACHE_TTL_24H; // 24 hours - data updates daily

function isTimingEnabled(): boolean {
  const v = (process.env.SB_TIMING ?? process.env.SOT_TIMING ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function slowMsThreshold(): number {
  const n = Number(process.env.SB_TIMING_SLOW_MS ?? String(SB_TIMING_SLOW_MS_DEFAULT)) || SB_TIMING_SLOW_MS_DEFAULT;
  return Math.max(0, n);
}

/** Supabase query error type */
export type SupabaseQueryError = { message: string; code?: string } | null;

/** Supabase query result */
export type SupabaseQueryResult<T> = { data: T | null; error: SupabaseQueryError };

/**
 * Cache Supabase query results for faster page loads.
 * Since data updates daily, we cache for 24 hours by default.
 *
 * @param queryFn - Function that returns a Supabase query (returns { data, error })
 * @param key - Unique cache key
 * @param revalidateSeconds - How long to cache (default: 24 hours)
 */
export async function cachedQuery<T>(
  queryFn: () => Promise<SupabaseQueryResult<T>>,
  key: string,
  revalidateSeconds: number | false = DEFAULT_REVALIDATE_SECONDS,
): Promise<SupabaseQueryResult<T>> {
  return unstable_cache(
    async () => {
      const timingOn = isTimingEnabled();
      const t0 = timingOn ? performance.now() : 0;
      try {
        const res = await queryFn();
        if (timingOn) {
          const ms = performance.now() - t0;
          if (ms >= slowMsThreshold()) {
            // Only logs on cache miss/revalidate (unstable_cache does not call this on cache hits).
            logDebug(`cachedQuery key=${key} ms=${ms.toFixed(1)} error=${res.error ? "yes" : "no"}`);
          }
        }
        return res;
      } catch (error) {
        if (timingOn) {
          const ms = performance.now() - t0;
          logDebug(`cachedQuery key=${key} ms=${ms.toFixed(1)} error=throw`);
        }
        const errorObj = error instanceof Error ? { message: error.message } : { message: String(error) };
        return { data: null, error: errorObj };
      }
    },
    [key],
    {
      revalidate: revalidateSeconds,
      // Generic tag plus key-specific tag so we can either
      // revalidate everything or target specific keys.
      tags: ["supabase", `supabase-${key}`],
    },
  )();
}

/**
 * Cache multiple queries in parallel with the same revalidation time.
 */
export async function cachedQueries<T extends Record<string, unknown>>(
  queries: {
    [K in keyof T]: () => Promise<SupabaseQueryResult<T[K]>>;
  },
  baseKey: string,
  revalidateSeconds: number | false = DEFAULT_REVALIDATE_SECONDS,
): Promise<{ [K in keyof T]: SupabaseQueryResult<T[K]> }> {
  const results = await Promise.all(
    Object.entries(queries).map(async ([name, queryFn]) => {
      const result = await cachedQuery(
        queryFn as () => Promise<SupabaseQueryResult<unknown>>,
        `${baseKey}-${name}`,
        revalidateSeconds,
      );
      return [name, result] as const;
    }),
  );

  return Object.fromEntries(results) as {
    [K in keyof T]: SupabaseQueryResult<T[K]>;
  };
}
