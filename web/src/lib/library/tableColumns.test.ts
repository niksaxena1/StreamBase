import { describe, expect, it } from "vitest";
import { libraryGridTemplate, libraryMinWidth, libraryPinnedOffsets, parseHiddenColumns, visibleLibraryColumns } from "./columns";

describe("visible Library columns", () => {
  it("defaults to hiding only catalog and ignores unknown or pinned ids", () => {
    expect(visibleLibraryColumns().map((c) => c.id)).not.toContain("catalog");
    expect(parseHiddenColumns('["streams","artist","unknown",42,"streams"]')).toEqual(["streams"]);
    expect(parseHiddenColumns("broken")).toEqual(["catalog"]);
    expect(parseHiddenColumns("{}")).toEqual(["catalog"]);
    expect(parseHiddenColumns("[]")).toEqual([]);
    expect(visibleLibraryColumns(["streams"]).map((c) => c.id)).not.toContain("streams");
    expect(visibleLibraryColumns([]).map((c) => c.id)).toContain("catalog");
  });
  it("computes grid tracks and minimum width from the visible list", () => {
    const columns = visibleLibraryColumns(["streams", "catalog"]);
    expect(libraryGridTemplate(columns)).toBe(columns.map((c) => c.track).join(" "));
    expect(libraryMinWidth(columns)).toBe(columns.reduce((sum, c) => sum + c.minPx, 0));
  });
  it("computes contiguous frozen widths from the column list", () => {
    const columns = visibleLibraryColumns();
    expect(Object.fromEntries(libraryPinnedOffsets(columns))).toEqual({ select: 0, cover: 32, release: 56, artist: 172, title: 342 });
    expect(libraryPinnedOffsets(columns.filter((c) => c.id !== "cover")).get("release")).toBe(32);
    expect(columns.find((c) => c.id === "artist")?.track).toBe("170px");
    expect(columns.find((c) => c.id === "title")?.track).toBe("210px");
  });
});
