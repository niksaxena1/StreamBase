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
  DateFilterResult,
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
  last_seen?: string | null;
  spotify_artist_names: string[];
  spotify_artist_ids: string[];
  total_streams_cumulative: number;
  daily_streams?: number | null;
  spotify_track_id: string | null;
  spotify_album_image_url: string | null;
  playlist_keys?: string[];
  _collectors?: string[];
  _distro_count?: number;
  _entity_count?: number;
  _moved_distro?: boolean;
  _moved_entity?: boolean;
  _moved_distro_playlists?: { name: string; imageUrl: string | null }[];
  _moved_entity_playlists?: { name: string; imageUrl: string | null }[];
  _has_duplicate_title?: boolean;
  _in_house_artist_ids?: string[];
};

export type ArtistDataPoint = {
  artist_id: string;
  artist_name: string;
  total_streams: number;
  track_count: number;
  daily_streams?: number;
  image_url: string | null;
  playlist_keys?: string[];
  _collectors?: string[];
  track_names?: string[];
  first_seen?: string | null;
  last_seen?: string | null;
  in_house_status?: "in_house" | "nih";
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
  est_total_revenue?: number;
  est_daily_revenue?: number | null;
  est_monthly_revenue?: number | null;
};

export type DateDataPoint = {
  date: string;
  daily_streams: number;
  cumulative_streams: number;
  track_count: number;
  growth_pct: number | null;
  tracks_added: number;
  day_of_week: number;
  est_daily_revenue: number | null;
  streams_per_track: number | null;
  is_weekend: boolean;
  moving_avg_7d: number | null;
  wow_growth_pct: number | null;
  missing_streams_count: number;
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
  // Single pass: filter + map together to avoid iterating the array twice.
  const out: TrackFilterResult[] = [];
  for (const t of tracks) {
    if (!evaluateFilter(t, filter, "tracks")) continue;
    out.push({
      isrc: t.isrc,
      name: t.name,
      release_date: t.release_date,
      first_seen: t.first_seen ?? null,
      last_seen: t.last_seen ?? null,
      spotify_artist_names: t.spotify_artist_names,
      spotify_artist_ids: t.spotify_artist_ids,
      total_streams: t.total_streams_cumulative,
      daily_streams: t.daily_streams ?? null,
      spotify_track_id: t.spotify_track_id,
      spotify_album_image_url: t.spotify_album_image_url,
      in_multiple_distro: (t._distro_count ?? 0) > 1,
      in_multiple_entity: (t._entity_count ?? 0) > 1,
      moved_distro_playlists: t._moved_distro_playlists ?? null,
      moved_entity_playlists: t._moved_entity_playlists ?? null,
      has_duplicate_title: t._has_duplicate_title ?? false,
    });
  }
  return out;
}

/**
 * Filter artists client-side (aggregated from tracks)
 */
export function filterArtistsClientSide(
  artists: ArtistDataPoint[],
  filter: FilterConfig
): ArtistFilterResult[] {
  const out: ArtistFilterResult[] = [];
  for (const a of artists) {
    if (!evaluateFilter(a, filter, "artists")) continue;
    out.push({
      artist_id: a.artist_id,
      artist_name: a.artist_name,
      total_streams: a.total_streams,
      track_count: a.track_count,
      daily_streams: a.daily_streams ?? null,
      avg_streams_per_track: a.track_count > 0 ? Math.round(a.total_streams / a.track_count) : 0,
      image_url: a.image_url,
      first_seen: a.first_seen ?? null,
      last_seen: a.last_seen ?? null,
      in_house_status: a.in_house_status ?? "nih",
    });
  }
  return out;
}

/**
 * Filter playlists client-side
 */
export function filterPlaylistsClientSide(
  playlists: PlaylistDataPoint[],
  filter: FilterConfig
): PlaylistFilterResult[] {
  const out: PlaylistFilterResult[] = [];
  for (const p of playlists) {
    if (!evaluateFilter(p, filter, "playlists")) continue;
    out.push({
      playlist_key: p.playlist_key,
      display_name: p.display_name,
      track_count: p.track_count,
      total_streams: p.total_streams,
      daily_streams: p.daily_streams,
      is_catalog: p.is_catalog,
      playlist_type: p.playlist_type,
      spotify_playlist_image_url: p.spotify_playlist_image_url,
      est_total_revenue: p.est_total_revenue ?? 0,
      est_daily_revenue: p.est_daily_revenue ?? null,
      est_monthly_revenue: p.est_monthly_revenue ?? null,
    });
  }
  return out;
}

/**
 * Filter dates client-side
 */
export function filterDatesClientSide(
  dates: DateDataPoint[],
  filter: FilterConfig
): DateFilterResult[] {
  const out: DateFilterResult[] = [];
  for (const d of dates) {
    if (!evaluateFilter(d, filter, "dates")) continue;
    out.push({
      date: d.date,
      daily_streams: d.daily_streams,
      cumulative_streams: d.cumulative_streams,
      track_count: d.track_count,
      growth_pct: d.growth_pct,
      tracks_added: d.tracks_added,
      day_of_week: d.day_of_week,
      est_daily_revenue: d.est_daily_revenue,
      streams_per_track: d.streams_per_track,
      is_weekend: d.is_weekend,
      moving_avg_7d: d.moving_avg_7d,
      wow_growth_pct: d.wow_growth_pct,
      missing_streams_count: d.missing_streams_count,
    });
  }
  return out;
}

/**
 * Aggregate tracks into artist data points
 */
export function aggregateTracksToArtistData(
  tracks: TrackDataPoint[],
  artistImages: Map<string, { name: string; image_url: string | null; in_house?: boolean }>
): ArtistDataPoint[] {
  const artistMap = new Map<string, {
    artist_id: string;
    artist_name: string;
    total_streams: number;
    daily_streams: number;
    track_count: number;
    image_url: string | null;
    playlist_keys: Set<string>;
    collectors: Set<string>;
    track_names: string[];
    first_seen: string | null;
    last_seen: string | null;
    in_house_status: "in_house" | "nih";
  }>();
  
  for (const track of tracks) {
    const ids = track.spotify_artist_ids ?? [];
    const names = track.spotify_artist_names ?? [];
    const pkeys = Array.isArray(track.playlist_keys) ? track.playlist_keys : [];
    const tcollectors = Array.isArray(track._collectors) ? track._collectors : [];
    
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
          collectors: new Set<string>(),
          track_names: [],
          first_seen: null,
          last_seen: null,
          in_house_status: imageInfo?.in_house ? "in_house" : "nih",
        });
      }
      
      const entry = artistMap.get(id)!;
      entry.total_streams += track.total_streams_cumulative;
      entry.daily_streams += track.daily_streams ?? 0;
      entry.track_count += 1;
      entry.track_names.push(track.name);
      for (const pk of pkeys) entry.playlist_keys.add(pk);
      for (const c of tcollectors) entry.collectors.add(c);
      const fs = track.first_seen;
      if (fs && (!entry.first_seen || fs < entry.first_seen)) entry.first_seen = fs;
      const ls = track.last_seen;
      if (ls && (!entry.last_seen || ls > entry.last_seen)) entry.last_seen = ls;
      if (track._in_house_artist_ids?.includes(id)) entry.in_house_status = "in_house";
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
    _collectors: Array.from(a.collectors),
    track_names: a.track_names,
    first_seen: a.first_seen,
    last_seen: a.last_seen,
    in_house_status: a.in_house_status,
  }));
}

// ============================================================================
// Filter Evaluation Logic
// ============================================================================

type DataRow = Record<string, unknown>;

/**
 * Evaluate a complete filter against a data row
 * Groups combine per `filter.groupJoinLogic` (default AND); conditions within each group follow that group's logic.
 */
function evaluateFilter(row: DataRow, filter: FilterConfig, entityType: string): boolean {
  const join = filter.groupJoinLogic ?? "AND";
  const groupResults = filter.groups.map((group) => evaluateGroup(row, group, entityType));
  if (groupResults.length === 0) return true;
  return join === "OR" ? groupResults.some(Boolean) : groupResults.every(Boolean);
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

  // Array-valued fields (e.g., has_track_named): match if ANY element satisfies the operator
  if (Array.isArray(rowValue)) {
    const compareFn = (item: unknown) => {
      switch (operator) {
        case "eq": return compareEqual(item, value);
        case "neq": return !compareEqual(item, value);
        case "contains": return compareContains(item, value);
        case "not_contains": return !compareContains(item, value);
        case "starts_with": return compareStartsWith(item, value);
        case "ends_with": return compareEndsWith(item, value);
        default: return false;
      }
    };
    if (operator === "neq" || operator === "not_contains") {
      return rowValue.every(compareFn);
    }
    return rowValue.some(compareFn);
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
    case "last_n_days":
      return compareDateLastNDays(rowValue, value);

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
 * Get the value from a row for a given field, handling field name mappings.
 * Computed/derived fields are resolved here so they never need to be stored on the row.
 */
function getRowValue(row: DataRow, field: string, entityType: string): unknown {
  // --- Network graph artists (collaboration graph modal filters) ---
  if (entityType === "network_artists") {
    if (field === "collab_partner") {
      return (row["_neighbor_ids"] as string[]) ?? [];
    }
  }

  // --- Playlist containment fields (resolved server-side, flag on the row) ---
  if (field === "contains_track" || field === "contains_artist") {
    return row["_contains_match"] === true ? "__match__" : "__no_match__";
  }

  // --- Array-valued lookup fields ---
  if (field === "has_track_named") {
    return (row["track_names"] as string[] | undefined) ?? [];
  }

  // --- Collector field (derived from playlist memberships) ---
  if (field === "collector" && (entityType === "tracks" || entityType === "artists")) {
    return (row["_collectors"] as string[] | undefined) ?? [];
  }

  // --- Distro/Entity playlist error-detection fields ---
  if (field === "in_multiple_distro") {
    return ((row["_distro_count"] as number | undefined) ?? 0) > 1;
  }
  if (field === "in_multiple_entity") {
    return ((row["_entity_count"] as number | undefined) ?? 0) > 1;
  }

  // --- Movement fields (resolved via /api/tracks/playlist-movements) ---
  if (field === "moved_distro") {
    return (row["_moved_distro"] as boolean | undefined) ?? false;
  }
  if (field === "moved_entity") {
    return (row["_moved_entity"] as boolean | undefined) ?? false;
  }

  // --- Duplicate title ---
  if (field === "has_duplicate_title") {
    return (row["_has_duplicate_title"] as boolean | undefined) ?? false;
  }
  if (field === "artist_in_house_status") {
    const inHouseIds = row["_in_house_artist_ids"] as string[] | undefined;
    return Array.isArray(inHouseIds) && inHouseIds.length > 0 ? "in_house" : "nih";
  }

  // --- Track computed fields ---
  if (field === "artist_count") {
    const ids = row["spotify_artist_ids"] as string[] | undefined;
    return Array.isArray(ids) ? ids.length : 0;
  }
  if (field === "days_since_release") {
    const rd = row["release_date"] as string | undefined;
    if (!rd) return null;
    const released = new Date(rd + "T00:00:00");
    if (isNaN(released.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor((now.getTime() - released.getTime()) / 86400000);
  }
  if (field === "in_any_playlist") {
    const keys = row["playlist_keys"] as string[] | undefined;
    return Array.isArray(keys) && keys.length > 0;
  }

  // --- Computed fields (entity-independent) ---
  if (field === "has_spotify_id") {
    const id = row["spotify_track_id"];
    return id != null && id !== "";
  }
  if (field === "is_collaboration") {
    const ids = row["spotify_artist_ids"] as string[] | undefined;
    return Array.isArray(ids) && ids.length > 1;
  }
  if (field === "avg_streams_per_track") {
    const total = Number(row["total_streams"] ?? 0);
    const count = Number(row["track_count"] ?? 1);
    return count > 0 ? total / count : 0;
  }

  // --- Track-specific field name mappings ---
  if (entityType === "tracks") {
    const trackMappings: Record<string, string> = {
      "total_streams": "total_streams_cumulative",
      "track_name": "name",
    };
    return row[trackMappings[field] ?? field];
  }

  // --- All other entities: direct field access ---
  return row[field];
}

// ============================================================================
// Comparison Functions
// ============================================================================

function compareEqual(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;

  // Array-valued fields (e.g., _collectors): match if any element equals the filter value
  if (Array.isArray(rowValue)) {
    return rowValue.some((v) => String(v) === String(filterValue));
  }
  
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

function compareDateLastNDays(rowValue: unknown, filterValue: FilterValue): boolean {
  if (rowValue == null) return false;
  const n = typeof filterValue === "number" ? filterValue : Number(filterValue);
  if (!n || n <= 0) return false;
  const dateStr = String(rowValue);
  const rowDate = new Date(dateStr + "T00:00:00");
  if (isNaN(rowDate.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - n);
  return rowDate >= cutoff;
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

  // Containment fields: the server-side lookup already resolved the match
  if (field === "contains_track" || field === "contains_artist") {
    return row["_contains_match"] === true;
  }
  
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

  // Array-valued row fields (e.g., _collectors): match if any element is in the filter values
  if (Array.isArray(rowValue)) {
    return filterValue.some(v => (rowValue as string[]).includes(v));
  }
  
  // Default: check if rowValue is in the filter array
  if (rowValue == null) return false;
  return filterValue.includes(String(rowValue));
}

// ============================================================================
// Network collaboration graph (client-side)
// ============================================================================

/**
 * Returns artist ids that pass the advanced filter. Expects `filter.entityType === "network_artists"`.
 * Uses the full loaded node list and edge list (same scope as the graph RPC).
 */
export type NetworkArtistStreamStatsRow = {
  total_streams_in_scope: number;
  daily_streams_in_scope: number;
};

/** True if any enabled condition uses one of the given field keys (values must be “active” per hasActiveConditions rules). */
export function networkFilterUsesFields(filter: FilterConfig | null, ...fieldKeys: string[]): boolean {
  if (!filter || filter.entityType !== "network_artists") return false;
  const want = new Set(fieldKeys);
  for (const g of filter.groups) {
    for (const c of g.conditions) {
      if (!c.enabled || !c.field || !want.has(c.field)) continue;
      const v = c.value;
      if (v == null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
    }
  }
  return false;
}

export function networkFilterUsesStreamFields(filter: FilterConfig | null): boolean {
  return networkFilterUsesFields(filter, "streams_total_scope", "streams_daily_scope");
}

export function filterNetworkArtistsClientSide(
  filter: FilterConfig,
  nodes: Array<{
    id: string;
    name: string;
    track_count: number;
    co_artists_any_track?: number;
    co_artists_primary_tracks?: number;
  }>,
  edges: Array<{ source: string; target: string }>,
  streamStatsByArtistId?: Map<string, NetworkArtistStreamStatsRow>,
): Set<string> {
  if (filter.entityType !== "network_artists") {
    return new Set(nodes.map((n) => n.id));
  }

  const needsStreams = networkFilterUsesStreamFields(filter);
  if (needsStreams && !streamStatsByArtistId) {
    return new Set();
  }

  const neighbors = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const out = new Set<string>();
  for (const n of nodes) {
    const neighborIds = neighbors.get(n.id) ?? new Set<string>();
    const st = streamStatsByArtistId?.get(n.id);
    const row: DataRow = {
      track_count: n.track_count,
      co_artists_playlist: n.co_artists_any_track ?? 0,
      co_artists_lead: n.co_artists_primary_tracks ?? 0,
      graph_collab_links: degree.get(n.id) ?? 0,
      artist_name: n.name,
      _neighbor_ids: Array.from(neighborIds),
      streams_total_scope: st != null ? st.total_streams_in_scope : null,
      streams_daily_scope: st != null ? st.daily_streams_in_scope : null,
    };
    if (evaluateFilter(row, filter, "network_artists")) {
      out.add(n.id);
    }
  }
  return out;
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
      if (!condition.enabled || !condition.field) continue;
      const v = condition.value;
      if (v == null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
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
      if (!condition.enabled || !condition.field) continue;
      const v = condition.value;
      if (v == null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      count++;
    }
  }
  return count;
}
