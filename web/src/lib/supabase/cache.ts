import { unstable_cache } from "next/cache";
import { logDebug } from "@/lib/logger";
import { CACHE_TTL_24H, SB_TIMING_SLOW_MS_DEFAULT } from "@/lib/constants";

const DEFAULT_REVALIDATE_SECONDS = CACHE_TTL_24H; // 24 hours - data updates daily
const MAX_CACHE_TAG_LENGTH = 256;

function isTimingEnabled(): boolean {
  const v = (process.env.SB_TIMING ?? process.env.SOT_TIMING ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function slowMsThreshold(): number {
  const n = Number(process.env.SB_TIMING_SLOW_MS ?? String(SB_TIMING_SLOW_MS_DEFAULT)) || SB_TIMING_SLOW_MS_DEFAULT;
  return Math.max(0, n);
}

function hashKey(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function cacheTagForKey(key: string): string {
  const prefix = "supabase-";
  const slug = key.replace(/[^A-Za-z0-9:_-]/g, "-");
  const hash = hashKey(key);
  const suffix = `-${hash}`;
  const maxSlugLength = MAX_CACHE_TAG_LENGTH - prefix.length - suffix.length;
  return `${prefix}${slug.slice(0, Math.max(0, maxSlugLength))}${suffix}`;
}

export function scopedAnalyticsCacheKey(args: {
  feature: string;
  datasetMode: "own" | "competitor";
  competitorLabelKey?: string | null;
  snapshotDate?: string | null;
  scope?: string | null;
}): string {
  if (args.datasetMode === "competitor" && !args.competitorLabelKey) {
    throw new Error("Competitor cache keys require competitorLabelKey");
  }
  return [
    args.feature,
    `dataset:${args.datasetMode}`,
    args.datasetMode === "competitor" ? `label:${args.competitorLabelKey}` : null,
    args.snapshotDate ? `date:${args.snapshotDate}` : null,
    args.scope ? `scope:${args.scope}` : null,
  ].filter(Boolean).join("|");
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
      tags: ["supabase", cacheTagForKey(key)],
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
