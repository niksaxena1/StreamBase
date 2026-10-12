import { foldForSearch } from "@/lib/searchFold";

import { formatDuration, parseDuration } from "./format";
import type { LibraryRow } from "./types";

export type LibrarySortKey = "release" | "artist" | "title" | "duration" | "catalog";
export type LibrarySortDir = "asc" | "desc";

export type LibraryFilters = {
  q: string;
  /** Entity codes. Empty means all. */
  entities: string[];
  year: string;
  distributor: string;
  labelGenre: string;
  originality: string;
  exclusivity: string;
  upcoming: boolean;
  released: boolean;
  hasMaster: boolean;
  missingIsrc: boolean;
  missingUpc: boolean;
  onDrive: boolean;
  splice: boolean;
  minDuration: number | null;
  maxDuration: number | null;
  sort: LibrarySortKey;
  dir: LibrarySortDir;
};

export const LIBRARY_SORT_KEYS: LibrarySortKey[] = ["release", "artist", "title", "duration", "catalog"];

export const LIBRARY_SORT_LABELS: Record<LibrarySortKey, string> = {
  release: "Release date",
  artist: "Artist",
  title: "Title",
  duration: "Length",
  catalog: "Catalog ID",
};

export function defaultSortDir(sort: LibrarySortKey): LibrarySortDir {
  return sort === "release" ? "desc" : "asc";
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  q: "",
  entities: [],
  year: "",
  distributor: "",
  labelGenre: "",
  originality: "",
  exclusivity: "",
  upcoming: false,
  released: false,
  hasMaster: false,
  missingIsrc: false,
  missingUpc: false,
  onDrive: false,
  splice: false,
  minDuration: null,
  maxDuration: null,
  sort: "release",
  dir: "desc",
};

/** Query-string keys owned by the filters (everything else, e.g. `id`, is left alone). */
export const LIBRARY_FILTER_PARAMS = [
  "q",
  "entity",
  "year",
  "distro",
  "genre",
  "orig",
  "excl",
  "upcoming",
  "released",
  "master",
  "noisrc",
  "noupc",
  "drive",
  "splice",
  "dmin",
  "dmax",
  "sort",
  "dir",
] as const;

type ParamsLike = { get(name: string): string | null };

/** Read filter state from a query string. Unknown or malformed values fall back to defaults. */
export function parseLibraryFilters(params: ParamsLike): LibraryFilters {
  const flag = (name: string) => params.get(name) === "1";
  const sortRaw = params.get("sort");
  const sort = LIBRARY_SORT_KEYS.find((k) => k === sortRaw) ?? DEFAULT_LIBRARY_FILTERS.sort;
  const dirRaw = params.get("dir");
  const dir: LibrarySortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultSortDir(sort);
  const year = params.get("year") ?? "";
  return {
    q: params.get("q") ?? "",
    entities: (params.get("entity") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    year: /^\d{4}$/.test(year) ? year : "",
    distributor: params.get("distro") ?? "",
    labelGenre: params.get("genre") ?? "",
    originality: params.get("orig") ?? "",
    exclusivity: params.get("excl") ?? "",
    upcoming: flag("upcoming"),
    released: flag("released"),
    hasMaster: flag("master"),
    missingIsrc: flag("noisrc"),
    missingUpc: flag("noupc"),
    onDrive: flag("drive"),
    splice: flag("splice"),
    minDuration: parseDuration(params.get("dmin")),
    maxDuration: parseDuration(params.get("dmax")),
    sort,
    dir,
  };
}

/** Write filter state as a query string. Defaults are omitted so URLs stay short. */
export function serializeLibraryFilters(f: LibraryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q);
  if (f.entities.length) p.set("entity", f.entities.join(","));
  if (f.year) p.set("year", f.year);
  if (f.distributor) p.set("distro", f.distributor);
  if (f.labelGenre) p.set("genre", f.labelGenre);
  if (f.originality) p.set("orig", f.originality);
  if (f.exclusivity) p.set("excl", f.exclusivity);
  if (f.upcoming) p.set("upcoming", "1");
  if (f.released) p.set("released", "1");
  if (f.hasMaster) p.set("master", "1");
  if (f.missingIsrc) p.set("noisrc", "1");
  if (f.missingUpc) p.set("noupc", "1");
  if (f.onDrive) p.set("drive", "1");
  if (f.splice) p.set("splice", "1");
  if (f.minDuration !== null) p.set("dmin", formatDuration(f.minDuration));
  if (f.maxDuration !== null) p.set("dmax", formatDuration(f.maxDuration));
  if (f.sort !== DEFAULT_LIBRARY_FILTERS.sort) p.set("sort", f.sort);
  if (f.dir !== defaultSortDir(f.sort)) p.set("dir", f.dir);
  return p;
}

/** Stable text form of the filters, for telling whether two states are the same view. */
export function libraryFiltersKey(f: LibraryFilters): string {
  return serializeLibraryFilters(f).toString();
}

/**
 * A query string (`?a=b`, or "" when empty) with the filter params replaced by
 * `f` and every other param (e.g. `id`) left alone. Applying it twice gives the
 * same result, so writing the URL from state can't trigger a state change.
 */
export function applyFiltersToSearch(search: string, f: LibraryFilters): string {
  const params = new URLSearchParams(search);
  for (const key of LIBRARY_FILTER_PARAMS) params.delete(key);
  for (const [key, value] of serializeLibraryFilters(f)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Filters to show after Back / Forward put `search` in the address bar.
 * Returns `current` itself when the URL describes the same view, so React skips the update.
 */
export function filtersAfterNavigation(current: LibraryFilters, search: string): LibraryFilters {
  const next = parseLibraryFilters(new URLSearchParams(search));
  return libraryFiltersKey(next) === libraryFiltersKey(current) ? current : next;
}

/** Reset every filter but keep the current sort. */
export function clearLibraryFilters(f: LibraryFilters): LibraryFilters {
  return { ...DEFAULT_LIBRARY_FILTERS, sort: f.sort, dir: f.dir };
}

/** Number of filters currently narrowing the list (sort is not a filter). */
export function activeFilterCount(f: LibraryFilters): number {
  let n = 0;
  if (f.q.trim()) n++;
  if (f.entities.length) n++;
  for (const v of [f.year, f.distributor, f.labelGenre, f.originality, f.exclusivity]) if (v) n++;
  for (const v of [f.upcoming, f.released, f.hasMaster, f.missingIsrc, f.missingUpc, f.onDrive, f.splice]) if (v) n++;
  if (f.minDuration !== null || f.maxDuration !== null) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Search

/** Folded text a row can be found by: artist, title, catalog ID, ISRC, UPC, comments, cover artist. */
export function buildSearchText(row: LibraryRow): string {
  return foldForSearch(
    [
      row.sheet_artist,
      row.sheet_title,
      row.title,
      row.artists?.join(" "),
      row.catalog_id,
      row.isrc,
      row.upc,
      row.comment_1,
      row.comment_2,
      row.cover_original_artist,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Every word of the query must appear somewhere in the folded row text. */
export function matchesQuery(searchText: string, query: string): boolean {
  const folded = foldForSearch(query);
  if (!folded) return true;
  return folded.split(" ").every((token) => searchText.includes(token));
}

// ---------------------------------------------------------------------------
// Individual predicates (each one is a pure row -> boolean)

export function releaseYear(row: LibraryRow): string {
  return row.release_date ? row.release_date.slice(0, 4) : "";
}

export function matchesEntities(row: LibraryRow, entities: string[]): boolean {
  return entities.length === 0 || (row.entity !== null && entities.includes(row.entity));
}

export function matchesYear(row: LibraryRow, year: string): boolean {
  return !year || releaseYear(row) === year;
}

export function matchesExact(value: string | null, wanted: string): boolean {
  return !wanted || value === wanted;
}

/** Upcoming = release date after `today`; Released = on or before `today`. Both on = any dated row. */
export function matchesTiming(row: LibraryRow, today: string, upcoming: boolean, released: boolean): boolean {
  if (!upcoming && !released) return true;
  if (!row.release_date) return false;
  const isUpcoming = row.release_date > today;
  return (upcoming && isUpcoming) || (released && !isUpcoming);
}

export function matchesDuration(row: LibraryRow, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  const d = row.master_duration_s;
  if (d === null) return false;
  if (min !== null && Math.round(d) < min) return false;
  if (max !== null && Math.round(d) > max) return false;
  return true;
}

const blank = (v: string | null) => !v || !v.trim();

export type FilterOptions = {
  /** Skip the entity filter (used for the entity chip counts). */
  skipEntities?: boolean;
  /** Pre-built search text per catalog ID, so typing stays fast. */
  searchIndex?: Map<string, string>;
};

export function rowMatches(row: LibraryRow, f: LibraryFilters, today: string, opts: FilterOptions = {}): boolean {
  if (f.q.trim()) {
    const text = opts.searchIndex?.get(row.catalog_id) ?? buildSearchText(row);
    if (!matchesQuery(text, f.q)) return false;
  }
  if (!opts.skipEntities && !matchesEntities(row, f.entities)) return false;
  if (!matchesYear(row, f.year)) return false;
  if (!matchesExact(row.distributor_account, f.distributor)) return false;
  if (!matchesExact(row.label_genre, f.labelGenre)) return false;
  if (!matchesExact(row.originality, f.originality)) return false;
  if (!matchesExact(row.exclusivity, f.exclusivity)) return false;
  if (!matchesTiming(row, today, f.upcoming, f.released)) return false;
  if (f.hasMaster && !row.has_m_master) return false;
  if (f.missingIsrc && !blank(row.isrc)) return false;
  if (f.missingUpc && !blank(row.upc)) return false;
  if (f.onDrive && blank(row.source_folder)) return false;
  if (f.splice && !row.non_exclusive_samples) return false;
  if (!matchesDuration(row, f.minDuration, f.maxDuration)) return false;
  return true;
}

export function filterRows(rows: LibraryRow[], f: LibraryFilters, today: string, opts: FilterOptions = {}): LibraryRow[] {
  return rows.filter((row) => rowMatches(row, f, today, opts));
}

export function buildSearchIndex(rows: LibraryRow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) index.set(row.catalog_id, buildSearchText(row));
  return index;
}

// ---------------------------------------------------------------------------
// Sorting

function textKey(row: LibraryRow, sort: LibrarySortKey): string | null {
  const v = sort === "artist" ? row.sheet_artist : sort === "title" ? row.sheet_title : row.catalog_id;
  return v && v.trim() ? v : null;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sorted copy. Rows with no value for the sort key always go last; ties break on catalog ID. */
export function sortRows(rows: LibraryRow[], sort: LibrarySortKey, dir: LibrarySortDir): LibraryRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    let aMissing = false;
    let bMissing = false;
    if (sort === "release") {
      aMissing = !a.release_date;
      bMissing = !b.release_date;
      if (!aMissing && !bMissing) cmp = a.release_date! < b.release_date! ? -1 : a.release_date! > b.release_date! ? 1 : 0;
    } else if (sort === "duration") {
      aMissing = a.master_duration_s === null;
      bMissing = b.master_duration_s === null;
      if (!aMissing && !bMissing) cmp = a.master_duration_s! - b.master_duration_s!;
    } else {
      const ka = textKey(a, sort);
      const kb = textKey(b, sort);
      aMissing = ka === null;
      bMissing = kb === null;
      if (ka !== null && kb !== null) cmp = collator.compare(ka, kb);
    }
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (cmp !== 0) return cmp * sign;
    return collator.compare(a.catalog_id, b.catalog_id);
  });
}

// ---------------------------------------------------------------------------
// Facets

/** Distinct non-empty values, sorted. */
export function distinctValues(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) if (v && v.trim()) set.add(v);
  return [...set].sort((a, b) => collator.compare(a, b));
}

/** Release years present in the data, newest first. */
export function releaseYears(rows: LibraryRow[]): string[] {
  return distinctValues(rows.map(releaseYear)).sort((a, b) => Number(b) - Number(a));
}

/** Rows per entity code, ignoring the entity filter itself. */
export function entityCounts(rows: LibraryRow[], f: LibraryFilters, today: string, searchIndex?: Map<string, string>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!rowMatches(row, f, today, { skipEntities: true, searchIndex })) continue;
    const key = row.entity ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function toggleEntity(entities: string[], code: string): string[] {
  return entities.includes(code) ? entities.filter((c) => c !== code) : [...entities, code];
}
