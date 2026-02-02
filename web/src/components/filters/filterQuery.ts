/**
 * Filter Query Execution
 * 
 * Converts filter configurations into executable queries (client-side filtering
 * or Supabase RPC calls)
 */

import type { 
  FilterConfig, 
  FilterGroup, 
  FilterCondition,
  FilterValue,
  TrackFilterResult,
  ArtistFilterResult,
  PlaylistFilterResult,
  FilterResult,
} from "./filterTypes";
import { foldForSearch } from "@/lib/searchFold";

// ============================================================================
// Track Data Type (from home page scatter points)
// ============================================================================

export type TrackDataPoint = {
  isrc: string;
  name: string;
  release_date: string | null;
  first_seen?: string | null;
  spotify_artist_names: string[];
  spotify_artist_ids: string[];
  total_streams_cumulative: number;
  daily_streams?: number | null;
  spotify_track_id: string | null;
  spotify_album_image_url: string | null;
  playlist_keys?: string[];
};

export type ArtistDataPoint = {
  artist_id: string;
  artist_name: string;
  total_streams: number;
  track_count: number;
  daily_streams?: number;
  image_url: string | null;
  playlist_keys?: string[];
};

export type PlaylistDataPoint = {
  playlist_key: string;
  display_name: string;
  track_count: number;
  total_streams: number;
  daily_streams: number | null;
  is_catalog: boolean;
  playlist_type: string | null;
  collector: string | null;
  spotify_playlist_image_url: string | null;
};

// ============================================================================
// Client-side Filter Execution
// ============================================================================

/**
 * Filter tracks client-side using in-memory data
 */
export function filterTracksClientSide(
  tracks: TrackDataPoint[],
  filter: FilterConfig
): TrackFilterResult[] {
  const filtered = tracks.filter(track => evaluateFilter(track, filter, "tracks"));
  
  return filtered.map(t => ({
    isrc: t.isrc,
    name: t.name,
    release_date: t.release_date,
    spotify_artist_names: t.spotify_artist_names,
    spotify_artist_ids: t.spotify_artist_ids,
    total_streams: t.total_streams_cumulative,
    daily_streams: t.daily_streams ?? null,
    spotify_track_id: t.spotify_track_id,
    spotify_album_image_url: t.spotify_album_image_url,
  }));
}

/**
 * Filter artists client-side (aggregated from tracks)
 */
export function filterArtistsClientSide(
  artists: ArtistDataPoint[],
  filter: FilterConfig
): ArtistFilterResult[] {
  const filtered = artists.filter(artist => evaluateFilter(artist, filter, "artists"));
  
  return filtered.map(a => ({
    artist_id: a.artist_id,
    artist_name: a.artist_name,
    total_streams: a.total_streams,
    track_count: a.track_count,
    image_url: a.image_url,
  }));
}

/**
 * Filter playlists client-side
 */
export function filterPlaylistsClientSide(
  playlists: PlaylistDataPoint[],
  filter: FilterConfig
): PlaylistFilterResult[] {
  const filtered = playlists.filter(playlist => evaluateFilter(playlist, filter, "playlists"));
  
  return filtered.map(p => ({
    playlist_key: p.playlist_key,
    display_name: p.display_name,
    track_count: p.track_count,
    total_streams: p.total_streams,
    daily_streams: p.daily_streams,
    is_catalog: p.is_catalog,
    playlist_type: p.playlist_type,
    spotify_playlist_image_url: p.spotify_playlist_image_url,
  }));
}

/**
 * Aggregate tracks into artist data points
 */
export function aggregateTracksToArtistData(
  tracks: TrackDataPoint[],
  artistImages: Map<string, { name: string; image_url: string | null }>
): ArtistDataPoint[] {
  const artistMap = new Map<string, {
    artist_id: string;
    artist_name: string;
    total_streams: number;
    daily_streams: number;
    track_count: number;
    image_url: string | null;
    playlist_keys: Set<string>;
  }>();
  
  for (const track of tracks) {
    const ids = track.spotify_artist_ids ?? [];
    const names = track.spotify_artist_names ?? [];
    const pkeys = Array.isArray(track.playlist_keys) ? track.playlist_keys : [];
    
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const name = names[i] ?? "Unknown";
      
      if (!artistMap.has(id)) {
        const imageInfo = artistImages.get(id);
        artistMap.set(id, {
          artist_id: id,
          artist_name: imageInfo?.name ?? name,
          total_streams: 0,
          daily_streams: 0,
          track_count: 0,
          image_url: imageInfo?.image_url ?? null,
          playlist_keys: new Set<string>(),
        });
      }
      
      const entry = artistMap.get(id)!;
      entry.total_streams += track.total_streams_cumulative;
      entry.daily_streams += track.daily_streams ?? 0;
      entry.track_count += 1;
      for (const pk of pkeys) entry.playlist_keys.add(pk);
    }
  }
  
  return Array.from(artistMap.values()).map((a) => ({
    artist_id: a.artist_id,
    artist_name: a.artist_name,
    total_streams: a.total_streams,
    daily_streams: a.daily_streams,
    track_count: a.track_count,
    image_url: a.image_url,
    playlist_keys: Array.from(a.playlist_keys),
  }));
}

// ============================================================================
// Filter Evaluation Logic
// ============================================================================

type DataRow = Record<string, unknown>;

/**
 * Evaluate a complete filter against a data row
 * Groups are AND'd together, conditions within groups follow group logic
 */
function evaluateFilter(row: DataRow, filter: FilterConfig, entityType: string): boolean {
  // All groups must match (AND between groups)
  for (const group of filter.groups) {
    if (!evaluateGroup(row, group, entityType)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluate a filter group
 */
function evaluateGroup(row: DataRow, group: FilterGroup, entityType: string): boolean {
  const activeConditions = group.conditions.filter(c => c.enabled && c.field);
  
  if (activeConditions.length === 0) {
    return true; // Empty group matches everything
  }
  
  if (group.logic === "AND") {
    return activeConditions.every(c => evaluateCondition(row, c, entityType));
  } else {
    return activeConditions.some(c => evaluateCondition(row, c, entityType));
  }
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(row: DataRow, condition: FilterCondition, entityType: string): boolean {
  const { field, operator, value } = condition;
  
  // Get the row value for this field (with field mapping)
  const rowValue = getRowValue(row, field, entityType);
  
  // Handle null/undefined values
  if (value === null || value === undefined || value === "") {
    return true; // Incomplete condition matches everything
  }
  
  // Dispatch to appropriate comparator
  switch (operator) {
    // Number operators
    case "eq":
      return compareEqual(rowValue, value);
    case "neq":
      return !compareEqual(rowValue, value);
    case "gt":
      return compareGreaterThan(rowValue, value);
    case "gte":
      return compareGreaterThanOrEqual(rowValue, value);
    case "lt":
      return compareLessThan(rowValue, value);
    case "lte":
      return compareLessThanOrEqual(rowValue, value);
    case "between":
      return compareBetween(rowValue, value);
    
    // Date operators
    case "before":
      return compareDateBefore(rowValue, value);
    case "after":
      return compareDateAfter(rowValue, value);
    case "month_is":
      return compareDateMonth(rowValue, value);
    case "year_is":
      return compareDateYear(rowValue, value);
    
    // Text operators
    case "contains":
      return compareContains(rowValue, value);
    case "not_contains":
      return !compareContains(rowValue, value);
    case "starts_with":
      return compareStartsWith(rowValue, value);
    case "ends_with":
      return compareEndsWith(rowValue, value);
    
    // Select operators
    case "in":
      return compareIn(rowValue, value, row, field);
    case "not_in":
      return !compareIn(rowValue, value, row, field);
    
    default:
      return true;
  }
}

/**
 * Get the value from a row for a given field, handling field name mappings
 */
function getRowValue(row: DataRow, field: string, entityType: string): unknown {
  // Handle field name differences between filter config and data
  const fieldMappings: Record<string, string> = {
    // Track fields
    "total_streams": "total_streams_cumulative",
    "track_name": "name",
    // Artist fields
    "artist_name": "artist_name",
    // Playlist fields
    "display_name": "display_name",
  };
  
  const mappedField = fieldMappings[field] ?? field;
  return row[mappedField];
}

// ============================================================================
// Comparison Functions
// ============================================================================

function compareEqual(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  
  // Handle boolean comparisons
  if (filterValue === "true") return rowValue === true;
  if (filterValue === "false") return rowValue === false;
  
  // Handle number comparisons
  if (typeof filterValue === "number") {
    return Number(rowValue) === filterValue;
  }
  
  // Handle string comparisons (case-insensitive for text)
  const rowStr = foldForSearch(String(rowValue));
  const filterStr = foldForSearch(String(filterValue));
  return rowStr === filterStr;
}

function compareGreaterThan(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  if (typeof filterValue !== "number") return false;
  return Number(rowValue) > filterValue;
}

function compareGreaterThanOrEqual(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  if (typeof filterValue !== "number") return false;
  return Number(rowValue) >= filterValue;
}

function compareLessThan(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  if (typeof filterValue !== "number") return false;
  return Number(rowValue) < filterValue;
}

function compareLessThanOrEqual(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  if (typeof filterValue !== "number") return false;
  return Number(rowValue) <= filterValue;
}

function compareBetween(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  
  // Handle number range
  if (filterValue && typeof filterValue === "object" && "min" in filterValue) {
    const { min, max } = filterValue as { min: number; max: number };
    const num = Number(rowValue);
    return num >= min && num <= max;
  }
  
  // Handle date range
  if (filterValue && typeof filterValue === "object" && "start" in filterValue) {
    const { start, end } = filterValue as { start: string; end: string };
    const date = String(rowValue);
    return date >= start && date <= end;
  }
  
  return false;
}

function compareDateBefore(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  return String(rowValue) < filterValue;
}

function compareDateAfter(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  return String(rowValue) > filterValue;
}

function compareDateMonth(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  const dateStr = String(rowValue);
  const month = parseInt(dateStr.split("-")[1] ?? "0", 10);
  return month === parseInt(filterValue, 10);
}

function compareDateYear(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  const dateStr = String(rowValue);
  const year = parseInt(dateStr.split("-")[0] ?? "0", 10);
  return year === parseInt(filterValue, 10);
}

function compareContains(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  const rowStr = foldForSearch(String(rowValue));
  const filterStr = foldForSearch(filterValue);
  return rowStr.includes(filterStr);
}

function compareStartsWith(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  const rowStr = foldForSearch(String(rowValue));
  const filterStr = foldForSearch(filterValue);
  return rowStr.startsWith(filterStr);
}

function compareEndsWith(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null || typeof filterValue !== "string") return false;
  const rowStr = foldForSearch(String(rowValue));
  const filterStr = foldForSearch(filterValue);
  return rowStr.endsWith(filterStr);
}

function compareIn(rowValue: unknown, filterValue: FilterValue, row: DataRow, field: string): boolean {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  
  // Special handling for artist field (check spotify_artist_ids array)
  if (field === "artist") {
    const artistIds = row["spotify_artist_ids"] as string[] | undefined;
    if (!Array.isArray(artistIds)) return false;
    return filterValue.some(v => artistIds.includes(v));
  }
  
  // Special handling for playlist field (check playlist_keys array)
  if (field === "playlist") {
    const playlistKeys = row["playlist_keys"] as string[] | undefined;
    if (!Array.isArray(playlistKeys)) return false;
    return filterValue.some(v => playlistKeys.includes(v));
  }
  
  // Default: check if rowValue is in the filter array
  if (rowValue == null) return false;
  return filterValue.includes(String(rowValue));
}

// ============================================================================
// Filter Validation
// ============================================================================

/**
 * Check if a filter has any active, complete conditions
 */
export function hasActiveConditions(filter: FilterConfig): boolean {
  for (const group of filter.groups) {
    for (const condition of group.conditions) {
      if (condition.enabled && condition.field && condition.value != null && condition.value !== "") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count active conditions in a filter
 */
export function countActiveConditions(filter: FilterConfig): number {
  let count = 0;
  for (const group of filter.groups) {
    for (const condition of group.conditions) {
      if (condition.enabled && condition.field && condition.value != null && condition.value !== "") {
        count++;
      }
    }
  }
  return count;
}
