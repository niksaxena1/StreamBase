import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeaderCells, RowCells } from "@/app/(main-flat)/library/LibraryTableCells";
import { makeRow } from "./testRows";
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

  it.each([
    [0, ["select"]], [375, ["select"]], [500, ["select"]], [531, ["select"]],
    [532, ["select", "cover", "release"]], [700, ["select", "cover", "release"]],
    [911, ["select", "cover", "release"]], [912, ["select", "cover", "release", "artist", "title"]],
    [1200, ["select", "cover", "release", "artist", "title"]],
  ])("reserves scrolling space at container width %i", (width, ids) => {
    const columns = visibleLibraryColumns();
    const offsets = libraryPinnedOffsets(columns, width as number);
    expect([...offsets.keys()]).toEqual(ids);
    if (offsets.size > 1) {
      const pinnedWidth = columns.filter((c) => offsets.has(c.id)).reduce((sum, c) => sum + c.minPx, 0);
      expect((width as number) - pinnedWidth).toBeGreaterThanOrEqual(360);
    }
  });

  it("uses column widths to choose the pin set when widths change", () => {
    const columns = visibleLibraryColumns().map((c) => c.id === "artist" ? { ...c, minPx: 200, track: "200px" } : c);
    expect([...libraryPinnedOffsets(columns, 912).keys()]).toEqual(["select", "cover", "release"]);
    expect(libraryPinnedOffsets(columns, 942).get("title")).toBe(372);
  });

  it.each([375, 700, 1200])("shares pinned positions and last-column border between headers and rows at %i px", (width) => {
    const columns = visibleLibraryColumns();
    const pinnedOffsets = libraryPinnedOffsets(columns, width);
    const header = renderToStaticMarkup(createElement(HeaderCells, { columns, pinnedOffsets, sort: "release", dir: "desc", onSort: () => {}, allSelected: false, someSelected: false, onToggleAll: () => {} }));
    const row = renderToStaticMarkup(createElement(RowCells, { columns, pinnedOffsets, row: makeRow(), entityNames: new Map(), checked: false, onToggle: () => {} }));
    const pins = (html: string) => [...html.matchAll(/data-column="([^"]+)" data-pinned="true" style="left:(\d+)(?:px)?"/g)].map((m) => [m[1], Number(m[2])]);
    expect(pins(header)).toEqual([...pinnedOffsets]);
    expect(pins(row)).toEqual([...pinnedOffsets]);
    expect(header.match(/data-pinned-last="true"/g)).toHaveLength(1);
    expect(row.match(/data-pinned-last="true"/g)).toHaveLength(1);
  });
});
