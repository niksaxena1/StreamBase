import type { DatasetMode } from "@/lib/datasetMode";
import { isPlaylistWatchOnlyAccess, type AppAccess } from "@/lib/appAccess";

export function datasetSchemaForMode(mode: DatasetMode) {
  return mode === "competitor" ? "competitor" : "public";
}

export function navItemsForMode<T extends { href: string }>(mode: DatasetMode, items: T[], access?: AppAccess) {
  if (access && isPlaylistWatchOnlyAccess(access)) {
    return items.filter((item) => item.href === "/playlist-watch");
  }

  const areaItems = items.filter((item) => item.href !== "/playlist-watch");
  const modeItems = mode === "competitor"
    ? areaItems.filter((item) => item.href !== "/collectors")
    : areaItems.filter((item) => item.href !== "/competitors");

  if (!access) return modeItems;
  return modeItems;
}

export type NavShortcutItem = {
  key: string;
  href: string;
  label: string;
};

const OWN_NAV_SHORTCUTS: NavShortcutItem[] = [
  { key: "1", href: "/", label: "Home" },
  { key: "2", href: "/playlists", label: "Playlists" },
  { key: "3", href: "/catalog", label: "Catalog" },
  { key: "4", href: "/collectors", label: "Collectors" },
  { key: "5", href: "/health", label: "Health" },
];

const COMPETITOR_NAV_SHORTCUTS: NavShortcutItem[] = [
  { key: "1", href: "/", label: "Home" },
  { key: "2", href: "/playlists", label: "Playlists" },
  { key: "3", href: "/catalog", label: "Catalog" },
  { key: "4", href: "/competitors", label: "Competitors" },
  { key: "5", href: "/health", label: "Health" },
];

/** Number-key nav shortcuts (1–5) for the current dataset mode. */
export function navShortcutItemsForMode(mode: DatasetMode, access?: AppAccess): NavShortcutItem[] {
  if (access && isPlaylistWatchOnlyAccess(access)) return [];
  return mode === "competitor" ? COMPETITOR_NAV_SHORTCUTS : OWN_NAV_SHORTCUTS;
}

export function navShortcutKeyForHref(
  href: string,
  mode: DatasetMode,
  access?: AppAccess,
): string | undefined {
  return navShortcutItemsForMode(mode, access).find((item) => item.href === href)?.key;
}
