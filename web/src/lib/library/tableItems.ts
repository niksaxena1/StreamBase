import type { LibrarySortDir, LibrarySortKey } from "./filters";
import type { LibraryRow } from "./types";

export const LIBRARY_ROW_HEIGHT = 32;
export const LIBRARY_GROUP_HEIGHT = 26;
export const LIBRARY_HEADER_HEIGHT = 32;

export type LibraryTableItem =
  | { kind: "row"; key: string; row: LibraryRow; rowIndex: number }
  | { kind: "month"; key: string; month: string; count: number; label: string }
  | { kind: "today"; key: string; label: string };

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const todayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Input is already filtered and sorted. Data indexes always refer to that input, never to decorations. */
export function buildLibraryItems(rows: readonly LibraryRow[], sort: LibrarySortKey, dir: LibrarySortDir, today: string): LibraryTableItem[] {
  if (sort !== "release") return rows.map((row, rowIndex) => ({ kind: "row", key: row.catalog_id, row, rowIndex }));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const month = row.release_date?.slice(0, 7) ?? "";
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  const items: LibraryTableItem[] = [];
  let lastMonth: string | null = null;
  let insertedToday = false;
  const insertToday = () => {
    items.push({ kind: "today", key: "today", label: `Today · ${todayFormat.format(new Date(`${today}T00:00:00Z`))}` });
    insertedToday = true;
  };
  rows.forEach((row, rowIndex) => {
    const date = row.release_date;
    // No-date rows stay after the dated timeline, including its Today marker.
    if (!insertedToday && counts.size > (counts.has("") ? 1 : 0) &&
      (!date || (dir === "asc" ? date > today : date <= today))) insertToday();
    const month = date?.slice(0, 7) ?? "";
    if (month !== lastMonth) {
      const count = counts.get(month)!;
      const label = month ? `${monthFormat.format(new Date(`${month}-01T00:00:00Z`))} · ${count} ${count === 1 ? "release" : "releases"}` : "No release date";
      items.push({ kind: "month", key: `month:${month}`, month, count, label });
      lastMonth = month;
    }
    items.push({ kind: "row", key: row.catalog_id, row, rowIndex });
  });
  if (!insertedToday && rows.some((r) => r.release_date)) insertToday();
  return items;
}

export function libraryItemHeight(item: LibraryTableItem): number {
  return item.kind === "row" ? LIBRARY_ROW_HEIGHT : LIBRARY_GROUP_HEIGHT;
}

export function libraryItemOffsets(items: readonly LibraryTableItem[]): number[] {
  let offset = 0;
  return items.map((item) => {
    const start = offset;
    offset += libraryItemHeight(item);
    return start;
  });
}

/** Leave three released row heights above Today; the pinned month occupies another 26px. */
export function libraryOpeningOffset(items: readonly LibraryTableItem[], sort: LibrarySortKey, dir: LibrarySortDir): number {
  if (sort !== "release" || dir !== "asc") return 0;
  const index = items.findIndex((item) => item.kind === "today");
  return index < 0 ? 0 : Math.max(0, libraryItemOffsets(items)[index] - 3 * LIBRARY_ROW_HEIGHT - LIBRARY_GROUP_HEIGHT);
}

/** A group entering the 26px overlay replaces the previous label before it can be obscured. */
export function pinnedLibraryMonth(groups: readonly { item: Extract<LibraryTableItem, { kind: "month" }>; offset: number }[], scrollTop: number) {
  let active: Extract<LibraryTableItem, { kind: "month" }> | undefined;
  for (const group of groups) {
    if (group.offset > scrollTop + LIBRARY_GROUP_HEIGHT) break;
    active = group.item;
  }
  return active;
}
