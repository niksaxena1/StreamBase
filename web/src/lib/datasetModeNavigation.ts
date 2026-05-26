import type { DatasetMode } from "@/lib/datasetMode";

const LEGACY_SEARCH_RECENTS_KEY = "sb_recent_search_items_v1";

/** Query params that select entities or views within one analytics universe. */
export const UNIVERSE_SCOPED_SEARCH_PARAMS = [
  "playlist_key",
  "artist_id",
  "isrc",
  "scope",
  "range",
  "daily",
  "xy_date",
  "start",
  "end",
  "date",
] as const;

const PATHS_STRIP_UNIVERSE_QUERY = ["/", "/playlists", "/catalog", "/health"] as const;

export function searchRecentsStorageKey(mode: DatasetMode): string {
  return `sb_recent_search_items_v1:${mode}`;
}

export function readSearchRecentsJson(mode: DatasetMode): unknown[] {
  if (typeof window === "undefined") return [];
  const scopedKey = searchRecentsStorageKey(mode);
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped) {
      const parsed = JSON.parse(scoped);
      return Array.isArray(parsed) ? parsed : [];
    }
    if (mode === "own") {
      const legacy = localStorage.getItem(LEGACY_SEARCH_RECENTS_KEY);
      if (legacy) {
        localStorage.setItem(scopedKey, legacy);
        return JSON.parse(legacy) as unknown[];
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function writeSearchRecentsJson(mode: DatasetMode, items: unknown[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(searchRecentsStorageKey(mode), JSON.stringify(items));
  } catch {
    // ignore
  }
}

/** Remove universe-specific query params; returns '' or '?foo=bar'. */
export function stripUniverseSearchParams(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw.trim()) return "";
  const params = new URLSearchParams(raw);
  for (const key of UNIVERSE_SCOPED_SEARCH_PARAMS) {
    params.delete(key);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Pathnames that should drop universe query params after a dataset mode switch. */
export function shouldStripUniverseQueryOnModeSwitch(pathname: string): boolean {
  return (PATHS_STRIP_UNIVERSE_QUERY as readonly string[]).includes(pathname);
}

/**
 * After switching dataset mode, return a clean URL path+query, or null to reload in place.
 */
export function pathAfterDatasetModeSwitch(pathname: string, search = ""): string | null {
  if (!shouldStripUniverseQueryOnModeSwitch(pathname)) return null;
  return `${pathname}${stripUniverseSearchParams(search)}`;
}

/** @deprecated Use pathAfterDatasetModeSwitch */
export function pathnameAfterDatasetModeSwitch(pathname: string): string | null {
  if (shouldStripUniverseQueryOnModeSwitch(pathname)) return pathname;
  return null;
}
