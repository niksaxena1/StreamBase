/**
 * Filter Storage Utilities
 * 
 * Handles saving and loading filters from localStorage.
 */

import type { FilterConfig } from "./filterTypes";

const STORAGE_KEY = "sb:filters:saved_v1";

function isClient(): boolean {
  return typeof window !== "undefined";
}

/**
 * Load all saved filters from localStorage
 */
export function loadSavedFilters(): FilterConfig[] {
  if (!isClient()) return [];
  
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    
    // Validate each filter has required fields
    return parsed.filter((f: unknown): f is FilterConfig => {
      if (!f || typeof f !== "object") return false;
      const obj = f as Record<string, unknown>;
      return (
        typeof obj.id === "string" &&
        typeof obj.name === "string" &&
        typeof obj.entityType === "string" &&
        Array.isArray(obj.groups)
      );
    });
  } catch {
    return [];
  }
}

/**
 * Save all filters to localStorage
 */
export function saveAllFilters(filters: FilterConfig[]): void {
  if (!isClient()) return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
}

/**
 * Save or update a single filter
 */
export function saveFilter(filter: FilterConfig): FilterConfig[] {
  const existing = loadSavedFilters();
  const idx = existing.findIndex(f => f.id === filter.id);
  
  const updated = {
    ...filter,
    updatedAt: new Date().toISOString(),
  };
  
  if (idx >= 0) {
    existing[idx] = updated;
  } else {
    existing.push(updated);
  }
  
  saveAllFilters(existing);
  return existing;
}

/**
 * Delete a filter by ID
 */
export function deleteFilter(filterId: string): FilterConfig[] {
  const existing = loadSavedFilters();
  const filtered = existing.filter(f => f.id !== filterId);
  saveAllFilters(filtered);
  return filtered;
}

/**
 * Get a single filter by ID
 */
function getFilterById(filterId: string): FilterConfig | null {
  const filters = loadSavedFilters();
  return filters.find(f => f.id === filterId) ?? null;
}

/**
 * Duplicate a filter with a new ID and name
 */
export function duplicateFilter(filterId: string, newName?: string): FilterConfig | null {
  const original = getFilterById(filterId);
  if (!original) return null;
  
  const duplicate: FilterConfig = {
    ...original,
    id: crypto.randomUUID(),
    name: newName ?? `${original.name} (copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Deep clone groups to avoid reference issues
    groups: JSON.parse(JSON.stringify(original.groups)),
  };
  
  saveFilter(duplicate);
  return duplicate;
}

/**
 * Export a filter as JSON string (for sharing)
 */
export function exportFilterAsJson(filter: FilterConfig): string {
  return JSON.stringify(filter, null, 2);
}

/**
 * Import a filter from JSON string
 */
export function importFilterFromJson(json: string): FilterConfig | null {
  try {
    const parsed = JSON.parse(json);
    
    // Validate structure
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.entityType !== "string" ||
      !Array.isArray(parsed.groups)
    ) {
      return null;
    }
    
    // Assign new ID and timestamps
    const imported: FilterConfig = {
      ...parsed,
      id: crypto.randomUUID(),
      name: parsed.name || "Imported Filter",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    return imported;
  } catch {
    return null;
  }
}

// ============================================================================
// Recent Filters (last used order)
// ============================================================================

const RECENT_KEY = "sb:filters:recent_v1";
const MAX_RECENT = 10;

export function getRecentFilterIds(): string[] {
  if (!isClient()) return [];
  
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markFilterAsRecent(filterId: string): void {
  if (!isClient()) return;
  
  try {
    const recent = getRecentFilterIds().filter(id => id !== filterId);
    recent.unshift(filterId);
    const trimmed = recent.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore
  }
}

