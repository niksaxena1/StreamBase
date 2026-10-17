import { describe, expect, it } from "vitest";

import { activeLibraryFilterChips } from "./activeFilterChips";
import { DEFAULT_LIBRARY_FILTERS, type LibraryFilters } from "./filters";

const f = (patch: Partial<LibraryFilters> = {}): LibraryFilters => ({ ...DEFAULT_LIBRARY_FILTERS, ...patch });

describe("activeLibraryFilterChips", () => {
  it("omits search, entity, year, sort and layout, including the TG + P default", () => {
    expect(activeLibraryFilterChips(f({ q: "artist", entities: ["tg", "p"], year: "2026", sort: "streams", view: "schedule" }))).toEqual([]);
  });

  it("labels every remaining facet, including URL-only preset filters", () => {
    const filters = f({
      distributor: "TG2 Amuse", labelGenre: "Dance", originality: "Original", exclusivity: "Exclusive",
      month: "2026-10", upcoming: true, released: true, hasMaster: true, missingIsrc: true, missingUpc: true,
      onDrive: true, splice: true, missingCode: true, minDuration: 180, maxDuration: 241, attention: "no_upc",
    });
    expect(activeLibraryFilterChips(filters).map((chip) => chip.label)).toEqual([
      "Distributor: TG2 Amuse", "Label / Genre: Dance", "Originality: Original", "Exclusivity: Exclusive", "Month: 2026-10",
      "Upcoming", "Released", "Has master", "Missing ISRC", "Missing UPC", "On drive", "Splice samples", "Missing codes",
      "Length \u2265 3:00", "Length \u2264 4:01", "Attention: Released without a UPC",
    ]);
  });

  it("removes only the selected facet and does not mutate its input", () => {
    const filters = f({ q: "artist", entities: ["tg"], year: "2026", missingIsrc: true, distributor: "Amuse", attention: "no_upc", minDuration: 0, maxDuration: 240, sort: "streams", dir: "asc", view: "schedule" });
    const snapshot = structuredClone(filters);
    for (const chip of activeLibraryFilterChips(filters)) {
      const next = { ...filters, ...chip.clear };
      expect(activeLibraryFilterChips(next).map((c) => c.key)).toEqual(activeLibraryFilterChips(filters).map((c) => c.key).filter((key) => key !== chip.key));
      expect(next).toEqual({ ...snapshot, [chip.key]: chip.clear[chip.key] });
    }
    expect(filters).toEqual(snapshot);
    expect(activeLibraryFilterChips(filters).find((c) => c.key === "minDuration")?.label).toBe("Length \u2265 0:00");
  });
});
