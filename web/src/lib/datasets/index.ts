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
