import type { DatasetMode } from "@/lib/datasetMode";
import type { AppAccess } from "@/lib/appAccess";

export function datasetSchemaForMode(mode: DatasetMode) {
  return mode === "competitor" ? "competitor" : "public";
}

export function navItemsForMode<T extends { href: string }>(mode: DatasetMode, items: T[], access?: AppAccess) {
  if (access && !access.ownCatalog && !access.competitor && access.playlistWatch) {
    return items.filter((item) => item.href === "/playlist-watch");
  }

  const modeItems = mode === "competitor"
    ? items.filter((item) => item.href !== "/collectors")
    : items.filter((item) => item.href !== "/competitors");

  if (!access) return modeItems;
  return modeItems.filter((item) => item.href !== "/playlist-watch" || access.playlistWatch);
}
