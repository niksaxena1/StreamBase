import type { DatasetMode } from "@/lib/datasetMode";

export function datasetSchemaForMode(mode: DatasetMode) {
  return mode === "competitor" ? "competitor" : "public";
}

export function navItemsForMode<T extends { href: string }>(mode: DatasetMode, items: T[]) {
  return mode === "competitor"
    ? items.filter((item) => item.href !== "/collectors")
    : items.filter((item) => item.href !== "/competitors");
}
