import { describe, expect, it } from "vitest";
import { sortRows } from "./filters";
import { buildLibraryItems, libraryItemOffsets, libraryOpeningOffset, pinnedLibraryMonth } from "./tableItems";
import { makeRow } from "./testRows";

const today = "2026-10-17";
const rows = ["2026-09-01", "2026-10-16", today, "2026-10-18", "2026-12-01", null].map((release_date, i) => makeRow({ catalog_id: String(i), release_date }));

describe("Library table items", () => {
  it.each(["asc", "desc"] as const)("groups filtered month counts and retains row indexes in %s order", (dir) => {
    const sorted = sortRows(rows, "release", dir);
    const items = buildLibraryItems(sorted, "release", dir, today);
    expect(items.filter((i) => i.kind === "month").map((i) => [i.month, i.count])).toEqual(dir === "asc"
      ? [["2026-09", 1], ["2026-10", 3], ["2026-12", 1], ["", 1]]
      : [["2026-12", 1], ["2026-10", 3], ["2026-09", 1], ["", 1]]);
    expect(items.filter((i) => i.kind === "row").map((i) => i.rowIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(items.at(-2)).toMatchObject({ kind: "month", label: "No release date" });
    const december = items.find((i) => i.kind === "month" && i.month === "2026-12");
    expect(december?.kind === "month" && december.label).toBe("December 2026 · 1 release");
    const split = items.findIndex((i) => i.kind === "today");
    const before = items.slice(0, split).filter((i) => i.kind === "row");
    const after = items.slice(split + 1).filter((i) => i.kind === "row" && i.row.release_date);
    expect(before.every((i) => i.kind === "row" && (dir === "asc" ? i.row.release_date! <= today : i.row.release_date! > today))).toBe(true);
    expect(after.every((i) => i.kind === "row" && (dir === "asc" ? i.row.release_date! > today : i.row.release_date! <= today))).toBe(true);
  });

  it.each(["asc", "desc"] as const)("includes Today with all upcoming or all released in %s order", (dir) => {
    for (const upcoming of [true, false]) {
      const subset = rows.filter((r) => r.release_date && (r.release_date > today) === upcoming);
      const items = buildLibraryItems(sortRows(subset, "release", dir), "release", dir, today);
      const split = items.findIndex((i) => i.kind === "today");
      expect(split).toBeGreaterThanOrEqual(0);
      expect(items.filter((i) => i.kind === "today")).toHaveLength(1);
      const atStart = dir === "asc" ? upcoming : !upcoming;
      expect(atStart ? split === 0 : split === items.length - 1).toBe(true);
    }
  });

  it("handles empty, undated-only and non-release sorts", () => {
    expect(buildLibraryItems([], "release", "asc", today)).toEqual([]);
    expect(buildLibraryItems([rows[5]], "release", "desc", today).map((i) => i.kind)).toEqual(["month", "row"]);
    expect(buildLibraryItems(rows, "artist", "asc", today).map((i) => i.kind)).toEqual(rows.map(() => "row"));
  });

  it("counts only the filtered rows", () => {
    const items = buildLibraryItems([rows[1], rows[2]], "release", "asc", today);
    expect(items[0]).toMatchObject({ kind: "month", count: 2, label: "October 2026 · 2 releases" });
  });

  it("opens ascending near Today and descending at the top", () => {
    const items = buildLibraryItems(sortRows(rows, "release", "asc"), "release", "asc", today);
    const offsets = libraryItemOffsets(items);
    expect(offsets[1] - offsets[0]).toBe(26);
    expect(offsets[2] - offsets[1]).toBe(32);
    expect(libraryOpeningOffset(items, "release", "asc")).toBe(Math.max(0, offsets[items.findIndex((i) => i.kind === "today")] - 96 - 26));
    expect(libraryOpeningOffset(items, "release", "desc")).toBe(0);
  });

  it("hands off the pinned label when the next group enters the overlay, including a short final group", () => {
    const items = buildLibraryItems(sortRows(rows, "release", "asc"), "release", "asc", today);
    const offsets = libraryItemOffsets(items);
    const groups = items.flatMap((item, index) => item.kind === "month" ? [{ item, offset: offsets[index] }] : []);
    expect(pinnedLibraryMonth(groups, groups.at(-1)!.offset - 6)?.label).toBe("No release date");
    expect(pinnedLibraryMonth(groups, groups[1].offset - 27)?.month).toBe("2026-09");
    expect(pinnedLibraryMonth(groups, groups[1].offset - 26)?.month).toBe("2026-10");
  });
});
