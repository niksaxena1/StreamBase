import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_REVALIDATE_SECONDS = 86400; // 24 hours - data updates daily

function isTimingEnabled(): boolean {
  const v = (process.env.SB_TIMING ?? process.env.SOT_TIMING ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function slowMsThreshold(): number {
  const n = Number(process.env.SB_TIMING_SLOW_MS ?? "250") || 250;
  return Math.max(0, n);
}

/**
 * Cache Supabase query results for faster page loads.
 * Since data updates daily, we cache for 24 hours by default.
 *
 * @param queryFn - Function that returns a Supabase query (returns { data, error })
 * @param key - Unique cache key
 * @param revalidateSeconds - How long to cache (default: 24 hours)
 */
export async function cachedQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  key: string,
  revalidateSeconds: number | false = DEFAULT_REVALIDATE_SECONDS, // 24h default, or false to disable
): Promise<{ data: T | null; error: any }> {
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
            console.log(`[cachedQuery] key=${key} ms=${ms.toFixed(1)} error=${res.error ? "yes" : "no"}`);
          }
        }
        return res;
      } catch (error) {
        if (timingOn) {
          const ms = performance.now() - t0;
          console.log(`[cachedQuery] key=${key} ms=${ms.toFixed(1)} error=throw`);
        }
        return { data: null, error };
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
export async function cachedQueries<T extends Record<string, any>>(
  queries: {
    [K in keyof T]: () => Promise<{ data: T[K] | null; error: any }>;
  },
  baseKey: string,
  revalidateSeconds: number | false = DEFAULT_REVALIDATE_SECONDS,
): Promise<{ [K in keyof T]: { data: T[K] | null; error: any } }> {
  const results = await Promise.all(
    Object.entries(queries).map(async ([name, queryFn]) => {
      const result = await cachedQuery(
        queryFn as () => Promise<{ data: any; error: any }>,
        `${baseKey}-${name}`,
        revalidateSeconds,
      );
      return [name, result] as const;
    }),
  );

  return Object.fromEntries(results) as {
    [K in keyof T]: { data: T[K] | null; error: any };
  };
}
