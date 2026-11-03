import { revalidateTag } from "next/cache";

import { cacheTagForKey } from "@/lib/supabase/cache";

/**
 * Cache keys for the Playlist Watch page's playlist list (active-only and with archived). Demo mode
 * gets its own keys so demo data can never be served from, or written to, the real entries. "v2"
 * retired entries cached before the demo row was excluded.
 */
export function playlistWatchCacheKey(includeArchived: boolean, demoMode = false): string {
  return `playlist-watch-v2-${demoMode ? "demo-" : ""}${includeArchived ? "all" : "active"}`;
}

/**
 * Expire the cached playlist list right away, so a playlist that was just added, archived or
 * unarchived shows up on the next page load instead of after the 1h cache TTL.
 */
export function expirePlaylistWatchCache(): void {
  for (const demoMode of [false, true]) {
    for (const includeArchived of [false, true]) {
      revalidateTag(cacheTagForKey(playlistWatchCacheKey(includeArchived, demoMode)), { expire: 0 });
    }
  }
}
