import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeaderCells, RowCells } from "@/app/(main-flat)/library/LibraryTableCells";
import { DEFAULT_LIBRARY_FILTERS } from "./filters";
import { LIBRARY_HEADER_FILTERS, libraryHeaderFilterActive } from "./headerFilters";
import { visibleLibraryColumns } from "./columns";
import { makeRow } from "./testRows";

describe("sheet headers", () => {
  it("maps each funnel to only its existing filter fields, including zero duration", () => {
    for (const [id, keys] of Object.entries(LIBRARY_HEADER_FILTERS)) {
      const column = id as keyof typeof LIBRARY_HEADER_FILTERS;
      expect(libraryHeaderFilterActive(column, DEFAULT_LIBRARY_FILTERS)).toBe(false);
      for (const key of keys) {
        const value = key.includes("Duration") ? 0 : typeof DEFAULT_LIBRARY_FILTERS[key] === "boolean" ? true : "value";
        expect(libraryHeaderFilterActive(column, { ...DEFAULT_LIBRARY_FILTERS, [key]: value })).toBe(true);
      }
    }
    expect(libraryHeaderFilterActive("artist", { ...DEFAULT_LIBRARY_FILTERS, year: "2026", hasMaster: true })).toBe(false);
  });

  it("renders keyboard reachable funnels and matching visible cell lists", () => {
    const columns = visibleLibraryColumns(["upc", "catalog", "comment2"]);
    const header = renderToStaticMarkup(createElement(HeaderCells, {
      columns, sort: "distributor", dir: "asc", onSort: () => {}, allSelected: false, someSelected: false, onToggleAll: () => {},
      headerFilters: { filters: { ...DEFAULT_LIBRARY_FILTERS, distributor: "Distro A" }, options: { years: [], distributors: [], labelGenres: [], originalities: [], exclusivities: [] }, onChange: () => {} },
    }));
    const row = renderToStaticMarkup(createElement(RowCells, { columns, row: makeRow(), entityNames: new Map(), checked: false, onToggle: () => {} }));
    expect(header).toContain('aria-label="Filter Release date"');
    expect(header).toContain('aria-label="Filter Orig."');
    expect(header).not.toContain('aria-label="Filter UPC"');
    expect(header).toContain('aria-sort="ascending"');
    expect((header.match(/role="columnheader"/g) ?? []).length).toBe(columns.length);
    expect((row.match(/role="cell"/g) ?? []).length).toBe(columns.length);
    expect(row).not.toContain('data-column="upc"');
    expect(row).not.toContain("<img");
    expect(row).toContain('data-pinned="true" style="left:342px"');
  });
});
