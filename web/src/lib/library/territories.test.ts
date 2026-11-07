import { describe, expect, it } from "vitest";

import { DEFAULT_LIBRARY_FILTERS, rowMatches } from "./filters";
import { activeLibraryFilterChips } from "./activeFilterChips";
import {
  matchesTerritoryGaps,
  mergeTerritoryGaps,
  parseTerritoryGapsFilter,
  territoryGapLabel,
  territoryGapTitle,
} from "./territories";
import { makeRow } from "./testRows";

describe("Library territory gaps", () => {
  const rows = [
    makeRow({ catalog_id: "A", isrc: "usabc2600001" }),
    makeRow({ catalog_id: "B", isrc: "USABC2600002" }),
    makeRow({ catalog_id: "C", isrc: null }),
  ];

  it("joins gaps by normalized ISRC and leaves other rows untouched", () => {
    const merged = mergeTerritoryGaps(rows, [{ isrc: "USABC2600001", markets: ["IN", "BR"] }]);
    expect(merged[0].territory_gaps).toEqual(["BR", "IN"]);
    expect(merged[1].territory_gaps).toBeUndefined();
    expect(merged[2].territory_gaps).toBeUndefined();
  });

  it("returns the same array when there are no gaps", () => {
    expect(mergeTerritoryGaps(rows, [])).toBe(rows);
  });

  it("parses and applies the any / none filter", () => {
    expect(parseTerritoryGapsFilter("any")).toBe("any");
    expect(parseTerritoryGapsFilter("none")).toBe("none");
    expect(parseTerritoryGapsFilter("x")).toBe("");
    const gap = makeRow({ territory_gaps: ["CA"] });
    const clean = makeRow();
    expect(matchesTerritoryGaps(gap, "any")).toBe(true);
    expect(matchesTerritoryGaps(clean, "any")).toBe(false);
    expect(matchesTerritoryGaps(gap, "none")).toBe(false);
    expect(matchesTerritoryGaps(clean, "none")).toBe(true);
    expect(rowMatches(gap, { ...DEFAULT_LIBRARY_FILTERS, territoryGaps: "none" }, "2026-06-01")).toBe(false);
  });

  it("labels the chip and tooltip", () => {
    expect(territoryGapLabel(["CA", "IN", "BR", "US"])).toBe("\u22124");
    expect(territoryGapTitle(["CA"])).toBe("Not playable in 1 territory: CA");
    expect(territoryGapTitle(["CA", "IN"])).toBe("Not playable in 2 territories: CA, IN");
  });

  it("shows an active-filter chip", () => {
    const chips = activeLibraryFilterChips({ ...DEFAULT_LIBRARY_FILTERS, territoryGaps: "any" });
    expect(chips.map((c) => c.label)).toContain("Territory gaps: Any");
  });
});
