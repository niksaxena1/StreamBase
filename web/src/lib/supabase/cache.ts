import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cache Supabase query results for faster page loads.
 * Since data updates daily, we cache for 1 hour by default.
 * 
 * @param queryFn - Function that returns a Supabase query (returns { data, error })
 * @param key - Unique cache key
 * @param revalidateSeconds - How long to cache (default: 1 hour)
 */
export async function cachedQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  key: string,
  revalidateSeconds: number | false = 3600, // 1 hour default, or false to disable
): Promise<{ data: T | null; error: any }> {
  return unstable_cache(
    async () => {
      try {
        return await queryFn();
      } catch (error) {
        return { data: null, error };
      }
    },
    [key],
    {
      revalidate: revalidateSeconds,
      tags: [`supabase-${key}`],
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
  revalidateSeconds = 3600,
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
