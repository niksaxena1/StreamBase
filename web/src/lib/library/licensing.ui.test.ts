import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryLicensingBadge } from "@/app/(main-flat)/library/LibraryLicensingBadge";
import { activeLibraryFilterChips } from "./activeFilterChips";
import { DEFAULT_LIBRARY_FILTERS } from "./filters";
import { LIBRARY_TABLE_COLUMNS, parseHiddenColumns } from "./columns";
import { libraryHeaderFilterActive } from "./headerFilters";
import { parseLicensing } from "./licensing";
import { libraryCsvRows } from "./exportCsv";
import { makeRow } from "./testRows";

const licensing = parseLicensing([
  { licensee: "Uniqode", pack: "Summer", batch_date: "2026-08-12", status: "sent", status_on: "2026-08-13" },
  { licensee: "UNIQODE", pack: "Autumn", batch_date: "2026-10-17", status: "staged", status_on: "2026-10-17" },
]);

describe("licensing columns and controls", () => {
  it("shows the newest compact badge, with every batch in the tooltip", () => {
    const html = renderToStaticMarkup(createElement(LibraryLicensingBadge, { licensing, licensee: "uniqode" }));
    expect(html).toContain("17.10.26 · Staged");
    expect(html).toContain("Summer · 12.08.26 · Sent (13.08.26)");
    expect(html).toContain("var(--sb-warning)");
    expect(html).toContain("background:transparent");
    const sent = renderToStaticMarkup(createElement(LibraryLicensingBadge, { licensing: licensing.slice(1), licensee: "Uniqode" }));
    expect(sent).toContain("var(--sb-positive)");
    expect(renderToStaticMarkup(createElement(LibraryLicensingBadge, { licensing, licensee: "Evenfall" }))).toBe("");
  });
  it("puts sortable and hideable columns after Comment 2", () => {
    const index = LIBRARY_TABLE_COLUMNS.findIndex((c) => c.id === "comment2");
    expect(LIBRARY_TABLE_COLUMNS.slice(index + 1, index + 3).map((c) => [c.id, c.sort])).toEqual([["uniqode", "uniqode"], ["evenfall", "evenfall"]]);
    expect(parseHiddenColumns('["uniqode","evenfall"]')).toEqual(["uniqode", "evenfall"]);
  });
  it("shows independent removable chips and active header filters", () => {
    const filters = { ...DEFAULT_LIBRARY_FILTERS, uniqode: "sent" as const, evenfall: "none" as const };
    expect(activeLibraryFilterChips(filters)).toEqual([
      { key: "uniqode", label: "Uniqode: Sent", clear: { uniqode: "" } },
      { key: "evenfall", label: "Evenfall: Not in a batch", clear: { evenfall: "" } },
    ]);
    expect(libraryHeaderFilterActive("uniqode", filters)).toBe(true);
    expect(libraryHeaderFilterActive("evenfall", DEFAULT_LIBRARY_FILTERS)).toBe(false);
  });
  it("exports readable newest-batch summaries for the provided rows only", () => {
    const records = libraryCsvRows([makeRow({ licensing })]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ Uniqode: "17.10.26 Staged", Evenfall: "" });
  });
});
