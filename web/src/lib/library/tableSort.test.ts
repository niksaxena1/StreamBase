import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_FILTERS, LIBRARY_SORT_LABELS, parseLibraryFilters, serializeLibraryFilters, sortRows, type LibrarySortKey } from "./filters";
import { makeRow } from "./testRows";
import type { LibraryRow } from "./types";

const fields = { entity: "entity", distributor: "distributor_account", labelGenre: "label_genre", isrc: "isrc", upc: "upc", comment1: "comment_1", comment2: "comment_2" } as const;
describe("sheet column sorting", () => {
  for (const [key, field] of Object.entries(fields)) {
    it.each(["asc", "desc"] as const)(`${key} sorts %s with blanks last and survives URL round trips`, (dir) => {
      const sort = key as LibrarySortKey;
      const rows = ["Bravo", null, " ", "Alpha"].map((value, i) => makeRow({ catalog_id: String(i), [field]: value } as Partial<LibraryRow>));
      expect(sortRows(rows, sort, dir).map((r) => r.catalog_id)).toEqual(dir === "asc" ? ["3", "0", "1", "2"] : ["0", "3", "1", "2"]);
      const filters = { ...DEFAULT_LIBRARY_FILTERS, sort, dir };
      expect(parseLibraryFilters(serializeLibraryFilters(filters))).toEqual(filters);
      expect(LIBRARY_SORT_LABELS[sort]).toBeTruthy();
    });
  }
});
