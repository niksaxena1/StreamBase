import { revalidateTag } from "next/cache";

import { cacheTagForKey } from "@/lib/supabase/cache";

/** Cache keys for the Playlist Watch page's playlist list (active-only and with archived). */
export function playlistWatchCacheKey(includeArchived: boolean): string {
  return `playlist-watch-${includeArchived ? "all" : "active"}`;
}

/**
 * Expire the cached playlist list right away, so a playlist that was just added, archived or
 * unarchived shows up on the next page load instead of after the 1h cache TTL.
 */
export function expirePlaylistWatchCache(): void {
  for (const includeArchived of [false, true]) {
    revalidateTag(cacheTagForKey(playlistWatchCacheKey(includeArchived)), { expire: 0 });
  }
}
