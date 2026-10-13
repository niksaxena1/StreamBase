import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_FILTERS,
  activeFilterCount,
  applyFiltersToSearch,
  buildSearchIndex,
  buildSearchText,
  clearLibraryFilters,
  entityCounts,
  filterRows,
  filtersAfterNavigation,
  libraryFiltersKey,
  matchesDuration,
  matchesQuery,
  matchesTiming,
  parseLibraryFilters,
  releaseYears,
  serializeLibraryFilters,
  sortRows,
  toggleEntity,
  type LibraryFilters,
} from "./filters";
import { makeRow } from "./testRows";

const TODAY = "2026-06-15";
const f = (over: Partial<LibraryFilters> = {}): LibraryFilters => ({ ...DEFAULT_LIBRARY_FILTERS, ...over });

const rows = [
  makeRow({
    catalog_id: "TG-00001",
    entity: "tg",
    release_date: "2026-03-01",
    sheet_artist: "Kyden",
    sheet_title: "Fast",
    isrc: "USABC2600001",
    upc: "012345678905",
    master_duration_s: 185,
    has_m_master: true,
    source_folder: "Y:\\Unreleased Ext Drive\\Kyden - Fast",
    distributor_account: "TG1 Amuse",
    label_genre: "Techno",
    originality: "Original",
    exclusivity: "Exclusive",
  }),
  makeRow({
    catalog_id: "TG-00002",
    entity: "tg",
    release_date: "2026-10-23",
    sheet_artist: "Zoë Ångström",
    sheet_title: "Night Drive",
    master_duration_s: 240,
    non_exclusive_samples: true,
    comment_1: "Waiting on splice certificate",
    distributor_account: "TG2 Amuse",
    label_genre: "House",
    originality: "Cover",
    cover_original_artist: "Daft Punk",
    exclusivity: "Non-Exclusive",
  }),
  makeRow({
    catalog_id: "P-00010",
    entity: "p",
    release_date: "2025-12-31",
    sheet_artist: "Mina",
    sheet_title: "Alpha",
    isrc: "GBXYZ2500010",
    master_duration_s: 60,
    distributor_account: "TG1 Amuse",
  }),
  makeRow({
    catalog_id: "LG-00003",
    entity: "legacy",
    release_date: null,
    sheet_artist: null,
    sheet_title: "Untitled",
    master_duration_s: null,
  }),
];

const ids = (list: ReturnType<typeof filterRows>) => list.map((r) => r.catalog_id);

describe("search", () => {
  it("folds case and accents", () => {
    expect(ids(filterRows(rows, f({ q: "zoe angstrom" }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ q: "KYDEN" }), TODAY))).toEqual(["TG-00001"]);
  });

  it("matches artist, title, catalog id, ISRC, UPC, comments and cover artist", () => {
    expect(ids(filterRows(rows, f({ q: "night drive" }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ q: "tg-00001" }), TODAY))).toEqual(["TG-00001"]);
    expect(ids(filterRows(rows, f({ q: "GBXYZ2500010" }), TODAY))).toEqual(["P-00010"]);
    expect(ids(filterRows(rows, f({ q: "012345678905" }), TODAY))).toEqual(["TG-00001"]);
    expect(ids(filterRows(rows, f({ q: "splice certificate" }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ q: "daft punk" }), TODAY))).toEqual(["TG-00002"]);
  });

  it("needs every word to match, in any order", () => {
    expect(ids(filterRows(rows, f({ q: "fast kyden" }), TODAY))).toEqual(["TG-00001"]);
    expect(ids(filterRows(rows, f({ q: "fast mina" }), TODAY))).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    expect(matchesQuery(buildSearchText(rows[0]), "   ")).toBe(true);
    expect(filterRows(rows, f({ q: "  " }), TODAY)).toHaveLength(4);
  });

  it("gives the same result with a prebuilt index", () => {
    const index = buildSearchIndex(rows);
    expect(ids(filterRows(rows, f({ q: "mina" }), TODAY, { searchIndex: index }))).toEqual(["P-00010"]);
  });
});

describe("filters", () => {
  it("entity: empty means all, otherwise any of the picked codes", () => {
    expect(filterRows(rows, f(), TODAY)).toHaveLength(4);
    expect(ids(filterRows(rows, f({ entities: ["p"] }), TODAY))).toEqual(["P-00010"]);
    expect(ids(filterRows(rows, f({ entities: ["p", "legacy"] }), TODAY))).toEqual(["P-00010", "LG-00003"]);
  });

  it("year uses the release date; undated rows never match a year", () => {
    expect(ids(filterRows(rows, f({ year: "2026" }), TODAY))).toEqual(["TG-00001", "TG-00002"]);
    expect(ids(filterRows(rows, f({ year: "2025" }), TODAY))).toEqual(["P-00010"]);
  });

  it("distributor, label/genre, originality and exclusivity are exact matches", () => {
    expect(ids(filterRows(rows, f({ distributor: "TG1 Amuse" }), TODAY))).toEqual(["TG-00001", "P-00010"]);
    expect(ids(filterRows(rows, f({ labelGenre: "House" }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ originality: "Cover" }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ exclusivity: "Non-Exclusive" }), TODAY))).toEqual(["TG-00002"]);
  });

  it("upcoming / released compare the release date with today", () => {
    expect(ids(filterRows(rows, f({ upcoming: true }), TODAY))).toEqual(["TG-00002"]);
    expect(ids(filterRows(rows, f({ released: true }), TODAY))).toEqual(["TG-00001", "P-00010"]);
    expect(ids(filterRows(rows, f({ upcoming: true, released: true }), TODAY))).toEqual([
      "TG-00001",
      "TG-00002",
      "P-00010",
    ]);
  });

  it("a release dated today counts as released", () => {
    const r = makeRow({ release_date: TODAY });
    expect(matchesTiming(r, TODAY, true, false)).toBe(false);
    expect(matchesTiming(r, TODAY, false, true)).toBe(true);
  });

  it("has master", () => {
    expect(ids(filterRows(rows, f({ hasMaster: true }), TODAY))).toEqual(["TG-00001"]);
  });

  it("missing ISRC / missing UPC", () => {
    expect(ids(filterRows(rows, f({ missingIsrc: true }), TODAY))).toEqual(["TG-00002", "LG-00003"]);
    expect(ids(filterRows(rows, f({ missingUpc: true }), TODAY))).toEqual(["TG-00002", "P-00010", "LG-00003"]);
    expect(ids(filterRows([makeRow({ isrc: "  " })], f({ missingIsrc: true }), TODAY))).toHaveLength(1);
  });

  it("on drive", () => {
    expect(ids(filterRows(rows, f({ onDrive: true }), TODAY))).toEqual(["TG-00001"]);
  });

  it("splice samples", () => {
    expect(ids(filterRows(rows, f({ splice: true }), TODAY))).toEqual(["TG-00002"]);
  });

  it("duration range is inclusive and excludes rows with no length", () => {
    expect(ids(filterRows(rows, f({ minDuration: 180 }), TODAY))).toEqual(["TG-00001", "TG-00002"]);
    expect(ids(filterRows(rows, f({ maxDuration: 185 }), TODAY))).toEqual(["TG-00001", "P-00010"]);
    expect(ids(filterRows(rows, f({ minDuration: 100, maxDuration: 200 }), TODAY))).toEqual(["TG-00001"]);
    expect(matchesDuration(makeRow({ master_duration_s: null }), null, null)).toBe(true);
    expect(matchesDuration(makeRow({ master_duration_s: null }), 0, null)).toBe(false);
  });

  it("combines filters with AND", () => {
    expect(ids(filterRows(rows, f({ distributor: "TG1 Amuse", missingIsrc: true }), TODAY))).toEqual([]);
    expect(ids(filterRows(rows, f({ distributor: "TG1 Amuse", hasMaster: true }), TODAY))).toEqual(["TG-00001"]);
  });

  it("counts filtered rows for the entity chips without applying the entity filter", () => {
    const counts = entityCounts(rows, f({ entities: ["p"], missingUpc: true }), TODAY);
    expect(counts.get("tg")).toBe(1);
    expect(counts.get("p")).toBe(1);
    expect(counts.get("legacy")).toBe(1);
  });

  it("toggles entities on and off", () => {
    expect(toggleEntity([], "tg")).toEqual(["tg"]);
    expect(toggleEntity(["tg", "p"], "tg")).toEqual(["p"]);
  });

  it("lists release years newest first", () => {
    expect(releaseYears(rows)).toEqual(["2026", "2025"]);
  });

  it("counts active filters and clears them but keeps the sort", () => {
    const active = f({ q: "x", year: "2026", hasMaster: true, minDuration: 10, sort: "artist", dir: "asc" });
    expect(activeFilterCount(active)).toBe(4);
    expect(activeFilterCount(DEFAULT_LIBRARY_FILTERS)).toBe(0);
    const cleared = clearLibraryFilters(active);
    expect(activeFilterCount(cleared)).toBe(0);
    expect(cleared.sort).toBe("artist");
    expect(cleared.dir).toBe("asc");
  });
});

describe("sortRows", () => {
  it("sorts by release date, newest first by default, undated last", () => {
    expect(sortRows(rows, "release", "desc").map((r) => r.catalog_id)).toEqual([
      "TG-00002",
      "TG-00001",
      "P-00010",
      "LG-00003",
    ]);
  });

  it("keeps rows with no value last in both directions", () => {
    expect(sortRows(rows, "release", "asc").map((r) => r.catalog_id)).toEqual([
      "P-00010",
      "TG-00001",
      "TG-00002",
      "LG-00003",
    ]);
    expect(sortRows(rows, "artist", "desc").at(-1)?.catalog_id).toBe("LG-00003");
  });

  it("sorts by artist ignoring case and accents", () => {
    const sorted = sortRows(rows, "artist", "asc").map((r) => r.sheet_artist);
    expect(sorted).toEqual(["Kyden", "Mina", "Zoë Ångström", null]);
  });

  it("sorts by title", () => {
    expect(sortRows(rows, "title", "asc").map((r) => r.sheet_title)).toEqual(["Alpha", "Fast", "Night Drive", "Untitled"]);
  });

  it("sorts by duration", () => {
    expect(sortRows(rows, "duration", "asc").map((r) => r.catalog_id)).toEqual([
      "P-00010",
      "TG-00001",
      "TG-00002",
      "LG-00003",
    ]);
    expect(sortRows(rows, "duration", "desc").map((r) => r.catalog_id)).toEqual([
      "TG-00002",
      "TG-00001",
      "P-00010",
      "LG-00003",
    ]);
  });

  it("sorts by catalog id with numbers in natural order", () => {
    const list = [makeRow({ catalog_id: "TG-100" }), makeRow({ catalog_id: "TG-20" }), makeRow({ catalog_id: "TG-3" })];
    expect(sortRows(list, "catalog", "asc").map((r) => r.catalog_id)).toEqual(["TG-3", "TG-20", "TG-100"]);
  });

  it("breaks ties on catalog id and does not mutate the input", () => {
    const list = [makeRow({ catalog_id: "B", sheet_artist: "X" }), makeRow({ catalog_id: "A", sheet_artist: "X" })];
    const copy = [...list];
    expect(sortRows(list, "artist", "desc").map((r) => r.catalog_id)).toEqual(["A", "B"]);
    expect(list).toEqual(copy);
  });
});

describe("URL <-> filter state", () => {
  it("omits defaults", () => {
    expect(serializeLibraryFilters(DEFAULT_LIBRARY_FILTERS).toString()).toBe("");
  });

  it("round trips every filter", () => {
    const full: LibraryFilters = {
      q: "kyden fast",
      entities: ["tg", "p"],
      year: "2026",
      distributor: "TG1 Amuse",
      labelGenre: "Deep House & Garage",
      originality: "Cover",
      exclusivity: "Non-Exclusive",
      upcoming: true,
      released: true,
      hasMaster: true,
      missingIsrc: true,
      missingUpc: true,
      onDrive: true,
      missingCode: true,
      month: "2026-03",
      attention: "no_master",
      splice: true,
      minDuration: 150,
      maxDuration: 245,
      sort: "duration",
      dir: "desc",
      view: "schedule",
    };
    const qs = serializeLibraryFilters(full).toString();
    expect(parseLibraryFilters(new URLSearchParams(qs))).toEqual(full);
  });

  it("round trips the default-sort and non-default-direction cases", () => {
    const a = f({ sort: "release", dir: "asc" });
    expect(parseLibraryFilters(serializeLibraryFilters(a))).toEqual(a);
    const b = f({ sort: "artist", dir: "asc" });
    expect(serializeLibraryFilters(b).toString()).toBe("sort=artist");
    expect(parseLibraryFilters(serializeLibraryFilters(b))).toEqual(b);
    const c = f({ sort: "artist", dir: "desc" });
    expect(parseLibraryFilters(serializeLibraryFilters(c))).toEqual(c);
  });

  it("shows durations as m:ss in the URL", () => {
    expect(serializeLibraryFilters(f({ minDuration: 185 })).get("dmin")).toBe("3:05");
  });

  it("ignores junk and unrelated params", () => {
    const parsed = parseLibraryFilters(new URLSearchParams("id=TG-00001&sort=nope&year=abc&dmin=zz&upcoming=yes&entity=,tg,"));
    expect(parsed).toEqual({ ...DEFAULT_LIBRARY_FILTERS, entities: ["tg"] });
  });
});

describe("URL sync: Back / Forward", () => {
  /** Minimal model of the browser history: a stack of query strings and a position. */
  function history(initial: string) {
    const stack = [initial];
    let at = 0;
    return {
      get search() {
        return stack[at];
      },
      push(search: string) {
        stack.splice(at + 1);
        stack.push(search);
        at++;
      },
      replace(search: string) {
        stack[at] = search;
      },
      back() {
        at--;
      },
      forward() {
        at++;
      },
    };
  }
  const withId = (search: string, id: string | null) => {
    const p = new URLSearchParams(search);
    if (id) p.set("id", id);
    else p.delete("id");
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  it("writes filters into the query string and keeps other params", () => {
    expect(applyFiltersToSearch("?id=TG-00001", f({ entities: ["p"], year: "2026" }))).toBe(
      "?id=TG-00001&entity=p&year=2026",
    );
    expect(applyFiltersToSearch("?entity=tg&year=2025&id=X", f())).toBe("?id=X");
    expect(applyFiltersToSearch("", f())).toBe("");
  });

  it("writing the URL is idempotent, so state -> URL -> state cannot loop", () => {
    const filters = f({ q: "kyden", entities: ["tg", "p"], minDuration: 185, sort: "artist", dir: "desc" });
    const once = applyFiltersToSearch("?id=TG-00001", filters);
    expect(applyFiltersToSearch(once, filters)).toBe(once);
    const reparsed = filtersAfterNavigation(filters, once);
    expect(reparsed).toBe(filters); // same view: the very same object, so React skips the render
  });

  it("returns the parsed filters when the URL describes a different view", () => {
    const next = filtersAfterNavigation(f({ entities: ["p"] }), "?entity=tg&year=2026");
    expect(next).toEqual(f({ entities: ["tg"], year: "2026" }));
    expect(libraryFiltersKey(next)).toBe("entity=tg&year=2026");
  });

  it("ignores changes that only touch the open release", () => {
    const current = f({ entities: ["tg"] });
    expect(filtersAfterNavigation(current, "?entity=tg&id=TG-00007")).toBe(current);
  });

  it("restores the filters on Back: entity A, open a release, close it, entity B, Back", () => {
    const A = f({ entities: ["tg"] });
    const B = f({ entities: ["p"] });
    const h = history("");

    let filters = A;
    h.replace(applyFiltersToSearch(h.search, filters)); // URL sync for A
    h.push(withId(h.search, "TG-00123")); // open a release (pushes history)
    h.replace(withId(h.search, null)); // close it
    filters = B;
    h.replace(applyFiltersToSearch(h.search, filters)); // URL sync for B
    expect(h.search).toBe("?entity=p");

    h.back(); // browser pops to the entry before the push
    expect(h.search).toBe("?entity=tg");
    filters = filtersAfterNavigation(filters, h.search);
    expect(filters).toEqual(A);

    // The sync effect that runs next leaves the URL alone.
    expect(applyFiltersToSearch(h.search, filters)).toBe(h.search);

    h.forward();
    filters = filtersAfterNavigation(filters, h.search);
    expect(filters).toEqual(B);
  });

  it("restores the filters when Back lands on the opened release", () => {
    const A = f({ entities: ["tg"], hasMaster: true });
    const h = history("");
    h.replace(applyFiltersToSearch(h.search, A));
    h.push(withId(h.search, "TG-00123"));
    h.push(applyFiltersToSearch(h.search, f({ entities: ["p"] }))); // changed a filter with the panel open
    h.back();
    const filters = filtersAfterNavigation(f({ entities: ["p"] }), h.search);
    expect(filters).toEqual(A);
    expect(new URLSearchParams(h.search).get("id")).toBe("TG-00123");
  });
});
