/**
 * Filter Storage Utilities
 *
 * Persists saved filters via the /api/filters/saved endpoint (Supabase-backed).
 * All CRUD operations are async.
 */

import type { FilterConfig } from "./filterTypes";

const API_BASE = "/api/filters/saved";

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Fetch all saved filters for the current user. */
export async function loadSavedFilters(): Promise<FilterConfig[]> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.filters) ? json.filters : [];
  } catch {
    return [];
  }
}

/** Create or update a saved filter. Returns the persisted filter. */
export async function saveFilter(filter: FilterConfig): Promise<FilterConfig | null> {
  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: filter.id,
        name: filter.name,
        entityType: filter.entityType,
        groups: filter.groups,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.filter ?? null;
  } catch {
    return null;
  }
}

/** Delete a filter by ID. Returns true on success. */
export async function deleteFilter(filterId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}?id=${encodeURIComponent(filterId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Duplicate a filter with a new server-generated ID. */
export async function duplicateFilter(
  filterId: string,
  allFilters: FilterConfig[],
  newName?: string,
): Promise<FilterConfig | null> {
  const original = allFilters.find((f) => f.id === filterId);
  if (!original) return null;

  const duplicate: FilterConfig = {
    id: "",
    name: newName ?? `${original.name} (copy)`,
    entityType: original.entityType,
    groups: JSON.parse(JSON.stringify(original.groups)),
    createdAt: "",
    updatedAt: "",
  };

  return saveFilter(duplicate);
}

// ---------------------------------------------------------------------------
// Import / Export (client-only, no API needed)
// ---------------------------------------------------------------------------

/** Export a filter as a formatted JSON string for sharing. */
export function exportFilterAsJson(filter: FilterConfig): string {
  return JSON.stringify(filter, null, 2);
}

/** Parse a JSON string into a FilterConfig (assigns no id — server will create one). */
export function importFilterFromJson(json: string): FilterConfig | null {
  try {
    const parsed = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.entityType !== "string" ||
      !Array.isArray(parsed.groups)
    ) {
      return null;
    }

    return {
      ...parsed,
      id: "",
      name: parsed.name || "Imported Filter",
      createdAt: "",
      updatedAt: "",
    } as FilterConfig;
  } catch {
    return null;
  }
}
