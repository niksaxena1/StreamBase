/**
 * Filter Builder Components
 * 
 * Dynamic query builder for filtering tracks, artists, and playlists
 */

// Main component
export { FilterBuilder } from "./FilterBuilder";
export type { TrackDataPoint, PlaylistDataPoint, DateDataPoint } from "./FilterBuilder";

// Types
export type {
  EntityType,
  FilterConfig,
  FilterGroup,
  FilterCondition,
  FilterOperator,
  FilterValue,
  TrackFilterResult,
  ArtistFilterResult,
  PlaylistFilterResult,
  DateFilterResult,
  FilterResult,
} from "./filterTypes";

// Utilities
export { createEmptyFilter, createEmptyGroup, createEmptyCondition } from "./filterTypes";
export { hasActiveConditions, countActiveConditions } from "./filterQuery";
export { loadSavedFilters, saveFilter, deleteFilter } from "./filterStorage";
