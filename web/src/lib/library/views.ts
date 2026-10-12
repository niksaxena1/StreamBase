import {
  DEFAULT_LIBRARY_FILTERS,
  applyFiltersToSearch,
  clearLibraryFilters,
  libraryFiltersKey,
  parseLibraryFilters,
  type LibraryFilters,
} from "./filters";
import type { LibraryAttention } from "./attention";

// ---------------------------------------------------------------------------
// URL state. With no `entity` param the page shows TG and P only; "all entities" is written as
// `all=1` so it survives a reload (an empty entity filter alone would read back as the default).

export const DEFAULT_LIBRARY_ENTITIES: readonly string[] = ["tg", "p"];

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function hasDefaultEntities(f: LibraryFilters): boolean {
  return sameSet(f.entities, DEFAULT_LIBRARY_ENTITIES);
}

/** Filter state for a query string, including the TG + P default. */
export function readLibraryUrlState(search: string): LibraryFilters {
  const params = new URLSearchParams(search);
  const filters = parseLibraryFilters(params);
  if (params.get("all") === "1") return { ...filters, entities: [] };
  if (!params.has("entity") || filters.entities.length === 0) return { ...filters, entities: [...DEFAULT_LIBRARY_ENTITIES] };
  return filters;
}

/** A query string (`?a=b`, or "") with the filter params replaced and every other param (e.g. `id`) kept. */
export function applyLibraryUrlState(search: string, f: LibraryFilters): string {
  const params = new URLSearchParams(applyFiltersToSearch(search, f));
  params.delete("all");
  if (f.entities.length === 0) params.set("all", "1");
  else if (hasDefaultEntities(f)) params.delete("entity");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Same contract as `filtersAfterNavigation`: returns `current` itself when the URL describes the same view. */
export function libraryStateAfterNavigation(current: LibraryFilters, search: string): LibraryFilters {
  const next = readLibraryUrlState(search);
  return libraryFiltersKey(next) === libraryFiltersKey(current) ? current : next;
}

/** "Clear filters": back to the page default (TG + P), keeping sort and view. */
export function resetLibraryFilters(f: LibraryFilters): LibraryFilters {
  return { ...clearLibraryFilters(f), entities: [...DEFAULT_LIBRARY_ENTITIES] };
}

/** How many filters narrow the list, not counting the TG + P default. */
export function narrowingFilterCount(f: LibraryFilters, count: number): number {
  return hasDefaultEntities(f) ? Math.max(count - 1, 0) : count;
}

// ---------------------------------------------------------------------------
// Preset views

export type LibraryPresetId = "all" | "upcoming" | "upcoming_tg" | "released_this_month" | "missing_codes" | "unassigned";

export const LIBRARY_PRESETS: Array<{ id: LibraryPresetId; label: string }> = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "upcoming_tg", label: "Upcoming TG" },
  { id: "released_this_month", label: "Released this month" },
  { id: "missing_codes", label: "Missing codes" },
  { id: "unassigned", label: "Unassigned" },
];

/** Filters for a preset. Search text, sort and the list/schedule choice carry over. */
export function presetFilters(id: LibraryPresetId, current: LibraryFilters, today: string): LibraryFilters {
  const base: LibraryFilters = { ...DEFAULT_LIBRARY_FILTERS, q: current.q, sort: current.sort, dir: current.dir, view: current.view };
  switch (id) {
    case "all":
      return { ...base, entities: [] };
    case "upcoming":
      return { ...base, entities: [], upcoming: true };
    case "upcoming_tg":
      return { ...base, entities: ["tg"], upcoming: true };
    case "released_this_month":
      return { ...base, entities: [], released: true, month: today.slice(0, 7) };
    case "missing_codes":
      return { ...base, entities: [...DEFAULT_LIBRARY_ENTITIES], missingCode: true };
    case "unassigned":
      return { ...base, entities: ["unassigned"] };
  }
}

/** The preset the current state equals (ignoring search, sort and view), or null. */
export function activePreset(current: LibraryFilters, today: string): LibraryPresetId | null {
  const neutral: LibraryFilters = { ...current, q: "", sort: DEFAULT_LIBRARY_FILTERS.sort, dir: DEFAULT_LIBRARY_FILTERS.dir, view: "list" };
  const key = libraryFiltersKey(neutral);
  for (const { id } of LIBRARY_PRESETS) {
    if (libraryFiltersKey(presetFilters(id, neutral, today)) === key) return id;
  }
  return null;
}

/** Filters for a clicked "needs attention" rule: that rule alone (plus the search text). Clicking it again clears it. */
export function attentionFilters(current: LibraryFilters, rule: LibraryAttention): LibraryFilters {
  if (current.attention === rule) return { ...resetLibraryFilters(current), q: current.q };
  return { ...clearLibraryFilters(current), q: current.q, entities: [], attention: rule };
}

// ---------------------------------------------------------------------------
// Saved views (browser storage only)

export const SAVED_VIEWS_KEY = "sb:library:saved-views";
const MAX_SAVED_VIEWS = 20;
const MAX_NAME_LENGTH = 40;

export type SavedView = { name: string; query: string };

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

/** Tolerant parse of what is in storage: anything that isn't a list of `{ name, query }` is dropped. */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: SavedView[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const { name, query } = item as Record<string, unknown>;
      if (typeof name === "string" && name.trim() && typeof query === "string") out.push({ name: name.trim(), query });
    }
    return out.slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

/** Raw stored text, or null when storage is missing or throws. */
export function readSavedViewsRaw(storage?: StorageReader): string | null {
  try {
    return (storage ?? window.localStorage).getItem(SAVED_VIEWS_KEY);
  } catch {
    return null;
  }
}

/** Saves the list; returns false when storage is unavailable. */
export function writeSavedViews(views: SavedView[], storage?: StorageWriter): boolean {
  try {
    (storage ?? window.localStorage).setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}

/** The view's query as stored: the current filters only (no open release), without the leading "?". */
export function savedViewQuery(f: LibraryFilters): string {
  return applyLibraryUrlState("", f).replace(/^\?/, "");
}

/** Adds a view, replacing one with the same name (ignoring case). Blank names are ignored. */
export function addSavedView(views: SavedView[], name: string, query: string): SavedView[] {
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) return views;
  const rest = views.filter((v) => v.name.toLowerCase() !== clean.toLowerCase());
  return [...rest, { name: clean, query }].slice(-MAX_SAVED_VIEWS);
}

export function removeSavedView(views: SavedView[], name: string): SavedView[] {
  return views.filter((v) => v.name !== name);
}

export function filtersForSavedView(view: SavedView): LibraryFilters {
  return readLibraryUrlState(view.query);
}

export function savedViewMatches(view: SavedView, current: LibraryFilters): boolean {
  return libraryFiltersKey(filtersForSavedView(view)) === libraryFiltersKey(current);
}
