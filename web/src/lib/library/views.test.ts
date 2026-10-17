import { describe, expect, it } from "vitest";

import { DEFAULT_LIBRARY_FILTERS, filterRows, type LibraryFilters } from "./filters";
import { makeRow } from "./testRows";
import {
  SAVED_VIEWS_KEY,
  activePreset,
  addSavedView,
  applyLibraryUrlState,
  attentionFilters,
  filtersForSavedView,
  hasDefaultEntities,
  libraryStateAfterNavigation,
  narrowingFilterCount,
  parseSavedViews,
  presetFilters,
  readLibraryUrlState,
  readSavedViewsRaw,
  removeSavedView,
  resetLibraryFilters,
  savedViewMatches,
  savedViewQuery,
  writeSavedViews,
} from "./views";

const TODAY = "2026-10-12";
const base: LibraryFilters = { ...DEFAULT_LIBRARY_FILTERS, entities: ["tg", "p"] };

describe("licensing views", () => {
  it("preserves licensing in saved views and Back/Forward while keeping the open panel", () => {
    const filters = { ...base, uniqode: "staged" as const, evenfall: "none" as const };
    const query = applyLibraryUrlState("?id=TG-1", filters);
    expect(query).toContain("uniq=staged");
    expect(query).toContain("even=none");
    expect(query).toContain("id=TG-1");
    expect(libraryStateAfterNavigation(base, query)).toEqual(filters);
    expect(filtersForSavedView({ name: "Licensing", query: savedViewQuery(filters) })).toEqual(filters);
    expect(savedViewMatches({ name: "Licensing", query: savedViewQuery(filters) }, base)).toBe(false);
    expect(activePreset(filters, TODAY)).toBeNull();
    expect(resetLibraryFilters(filters)).toEqual(base);
  });
});

const rows = [
  makeRow({ catalog_id: "TG-1", entity: "tg", release_date: "2026-10-20" }),
  makeRow({ catalog_id: "TG-2", entity: "tg", release_date: "2026-10-05", isrc: "USABC2600001", upc: "012345678905" }),
  makeRow({ catalog_id: "P-1", entity: "p", release_date: "2026-09-05", isrc: "USABC2600002", upc: null }),
  makeRow({ catalog_id: "P-2", entity: "p", release_date: "2026-10-20" }),
  makeRow({ catalog_id: "LG-1", entity: "legacy", release_date: "2022-01-01" }),
  makeRow({ catalog_id: "UN-1", entity: "unassigned", release_date: "2023-01-01" }),
  makeRow({ catalog_id: "TG-3", entity: "tg", release_date: null }),
];
const ids = (f: LibraryFilters) => filterRows(rows, f, TODAY).map((r) => r.catalog_id);

describe("default URL state", () => {
  it("shows TG and P when the URL has no entity param", () => {
    expect(readLibraryUrlState("").entities).toEqual(["tg", "p"]);
    expect(readLibraryUrlState("?sort=artist").entities).toEqual(["tg", "p"]);
    expect(readLibraryUrlState("?id=TG-1").entities).toEqual(["tg", "p"]);
    expect(readLibraryUrlState("").sort).toBe("release");
    expect(readLibraryUrlState("").dir).toBe("desc");
  });
  it("reads an explicit entity list and the all sentinel", () => {
    expect(readLibraryUrlState("?entity=legacy").entities).toEqual(["legacy"]);
    expect(readLibraryUrlState("?all=1").entities).toEqual([]);
  });
  it("omits the default entities and writes all=1 for no entity filter", () => {
    expect(applyLibraryUrlState("", base)).toBe("");
    expect(applyLibraryUrlState("", { ...base, entities: [] })).toBe("?all=1");
    expect(applyLibraryUrlState("", { ...base, entities: ["legacy"] })).toBe("?entity=legacy");
  });
  it("keeps unrelated params and is idempotent", () => {
    const once = applyLibraryUrlState("?id=TG-1&entity=legacy", { ...base, entities: [] });
    expect(once).toContain("id=TG-1");
    expect(once).toContain("all=1");
    expect(once).not.toContain("entity=");
    expect(applyLibraryUrlState(once, { ...base, entities: [] })).toBe(once);
  });
  it("round trips every entity state", () => {
    for (const entities of [[], ["tg", "p"], ["tg"], ["legacy", "n"]]) {
      const f: LibraryFilters = { ...base, entities, view: "schedule", attention: "no_isrc" };
      expect(readLibraryUrlState(applyLibraryUrlState("", f))).toEqual(f);
    }
  });
  it("returns the same object after navigation when nothing changed", () => {
    const current = readLibraryUrlState("?entity=legacy");
    expect(libraryStateAfterNavigation(current, "?entity=legacy&id=TG-1")).toBe(current);
    expect(libraryStateAfterNavigation(current, "?all=1").entities).toEqual([]);
  });
  it("does not count the default entities as a filter", () => {
    expect(narrowingFilterCount(base, 1)).toBe(0);
    expect(narrowingFilterCount({ ...base, entities: ["tg"] }, 1)).toBe(1);
    expect(hasDefaultEntities({ ...base, entities: ["p", "tg"] })).toBe(true);
  });
  it("resets to the default entities, keeping sort and view", () => {
    const reset = resetLibraryFilters({
      ...base,
      entities: [],
      q: "x",
      sort: "artist",
      dir: "asc",
      view: "schedule",
      attention: "no_master",
    });
    expect(reset).toEqual({ ...DEFAULT_LIBRARY_FILTERS, entities: ["tg", "p"], sort: "artist", dir: "asc", view: "schedule" });
  });
  it("the default list leaves out unassigned and legacy rows", () => {
    expect(ids(base)).toEqual(["TG-1", "TG-2", "P-1", "P-2", "TG-3"]);
  });
});

describe("presets", () => {
  it("All shows everything", () => {
    expect(ids(presetFilters("all", base, TODAY))).toHaveLength(rows.length);
  });
  it("Upcoming", () => {
    expect(ids(presetFilters("upcoming", base, TODAY))).toEqual(["TG-1", "P-2"]);
  });
  it("Upcoming TG", () => {
    expect(ids(presetFilters("upcoming_tg", base, TODAY))).toEqual(["TG-1"]);
  });
  it("Released this month", () => {
    expect(ids(presetFilters("released_this_month", base, TODAY))).toEqual(["TG-2"]);
  });
  it("Missing codes: released TG or P with no ISRC or no UPC", () => {
    expect(ids(presetFilters("missing_codes", base, TODAY))).toEqual(["P-1"]);
  });
  it("Unassigned", () => {
    expect(ids(presetFilters("unassigned", base, TODAY))).toEqual(["UN-1"]);
  });
  it("keeps the search text, sort and view", () => {
    const f = presetFilters("upcoming", { ...base, q: "kyden", sort: "artist", dir: "asc", view: "schedule" }, TODAY);
    expect(f).toMatchObject({ q: "kyden", sort: "artist", dir: "asc", view: "schedule", upcoming: true });
  });
  it("highlights the preset that matches the state, ignoring search, sort and view", () => {
    expect(activePreset(presetFilters("upcoming_tg", base, TODAY), TODAY)).toBe("upcoming_tg");
    expect(activePreset({ ...presetFilters("all", base, TODAY), q: "x", sort: "artist", view: "schedule" }, TODAY)).toBe("all");
    expect(activePreset(presetFilters("released_this_month", base, TODAY), TODAY)).toBe("released_this_month");
    expect(activePreset(base, TODAY)).toBeNull();
    expect(activePreset({ ...base, year: "2026" }, TODAY)).toBeNull();
  });
  it("survives a trip through the URL", () => {
    for (const id of ["all", "upcoming", "upcoming_tg", "released_this_month", "missing_codes", "unassigned"] as const) {
      const f = presetFilters(id, base, TODAY);
      expect(activePreset(readLibraryUrlState(applyLibraryUrlState("", f)), TODAY)).toBe(id);
    }
  });
});

describe("attention filters", () => {
  it("shows exactly the rule's releases, across all entities, and keeps the search", () => {
    const f = attentionFilters({ ...base, q: "x", year: "2026", upcoming: true }, "unassigned");
    expect(f).toMatchObject({ q: "x", attention: "unassigned", entities: [], year: "", upcoming: false });
    expect(ids({ ...f, q: "" })).toEqual(["UN-1"]);
  });
  it("clicking the active rule again goes back to the default list", () => {
    const on = attentionFilters(base, "no_isrc");
    expect(attentionFilters(on, "no_isrc")).toEqual(base);
  });
  it("is kept in the URL", () => {
    const f = attentionFilters(base, "no_master");
    expect(readLibraryUrlState(applyLibraryUrlState("", f)).attention).toBe("no_master");
  });
});

describe("saved views", () => {
  const memory = (initial: string | null = null) => {
    let value = initial;
    return {
      getItem: () => value,
      setItem: (_key: string, v: string) => {
        value = v;
      },
    };
  };
  const throwing = {
    getItem: (): string | null => {
      throw new Error("blocked");
    },
    setItem: (): void => {
      throw new Error("blocked");
    },
  };

  it("stores the filters as a query without the open release", () => {
    const f = presetFilters("upcoming_tg", base, TODAY);
    const query = savedViewQuery(f);
    expect(query).not.toContain("id=");
    expect(query.startsWith("?")).toBe(false);
    expect(filtersForSavedView({ name: "x", query })).toEqual(f);
  });
  it("adds, replaces by name (ignoring case) and removes", () => {
    let views = addSavedView([], "  Tuesday check ", "entity=tg");
    views = addSavedView(views, "Other", "all=1");
    views = addSavedView(views, "tuesday CHECK", "entity=p");
    expect(views).toEqual([
      { name: "Other", query: "all=1" },
      { name: "tuesday CHECK", query: "entity=p" },
    ]);
    expect(removeSavedView(views, "Other")).toEqual([{ name: "tuesday CHECK", query: "entity=p" }]);
    expect(addSavedView(views, "   ", "x")).toBe(views);
  });
  it("round trips through storage", () => {
    const storage = memory();
    expect(writeSavedViews([{ name: "A", query: "entity=tg" }], storage)).toBe(true);
    expect(parseSavedViews(readSavedViewsRaw(storage))).toEqual([{ name: "A", query: "entity=tg" }]);
  });
  it("ignores junk in storage", () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("not json")).toEqual([]);
    expect(parseSavedViews('{"a":1}')).toEqual([]);
    expect(parseSavedViews('[1,{"name":"ok","query":"all=1"},{"name":"","query":"x"},{"name":"n"}]')).toEqual([
      { name: "ok", query: "all=1" },
    ]);
  });
  it("copes with storage that throws", () => {
    expect(readSavedViewsRaw(throwing)).toBeNull();
    expect(writeSavedViews([{ name: "A", query: "" }], throwing)).toBe(false);
    expect(SAVED_VIEWS_KEY).toBeTruthy();
  });
  it("highlights the saved view that equals the current state", () => {
    const f = presetFilters("unassigned", base, TODAY);
    const view = { name: "U", query: savedViewQuery(f) };
    expect(savedViewMatches(view, f)).toBe(true);
    expect(savedViewMatches(view, { ...f, q: "x" })).toBe(false);
    expect(savedViewMatches(view, base)).toBe(false);
  });
});
