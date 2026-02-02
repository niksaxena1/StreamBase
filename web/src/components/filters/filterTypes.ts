/**
 * Filter Builder Type Definitions
 * 
 * A dynamic query builder system for filtering tracks, artists, and playlists
 * without writing code.
 */

// ============================================================================
// Core Filter Types
// ============================================================================

export type EntityType = "tracks" | "artists" | "playlists";

export type FieldType = "number" | "date" | "text" | "select" | "multi-select" | "boolean";

export type NumberOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";
export type DateOperator = "eq" | "before" | "after" | "between" | "month_is" | "year_is";
export type TextOperator = "eq" | "neq" | "contains" | "not_contains" | "starts_with" | "ends_with";
export type SelectOperator = "eq" | "neq" | "in" | "not_in";
export type BooleanOperator = "eq";

export type FilterOperator = 
  | NumberOperator 
  | DateOperator 
  | TextOperator 
  | SelectOperator 
  | BooleanOperator;

// Value types for different field types
export type FilterValue = 
  | string 
  | number 
  | boolean 
  | null
  | { min: number; max: number }           // for "between" on numbers
  | { start: string; end: string }         // for "between" on dates
  | string[];                              // for "in" / "not_in" on select

// ============================================================================
// Filter Condition & Group
// ============================================================================

export type FilterCondition = {
  id: string;
  field: string;           // The field key from filterConfig
  operator: FilterOperator;
  value: FilterValue;
  enabled: boolean;        // Allow toggling conditions without deleting
};

export type FilterGroupLogic = "AND" | "OR";

export type FilterGroup = {
  id: string;
  logic: FilterGroupLogic;
  conditions: FilterCondition[];
};

// ============================================================================
// Complete Filter Configuration
// ============================================================================

export type FilterConfig = {
  id: string;
  name: string;
  entityType: EntityType;
  groups: FilterGroup[];
  createdAt: string;
  updatedAt: string;
};

// ============================================================================
// Field Definition (used in filterConfig.ts)
// ============================================================================

export type FilterFieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  operators: FilterOperator[];
  description?: string;
  // For select/multi-select fields
  options?: Array<{ value: string; label: string }>;
  // For async options (e.g., artists loaded from data)
  optionsSource?: "artists" | "playlists" | "collectors";
  // For number fields
  min?: number;
  max?: number;
  step?: number;
  // For date fields
  minDate?: string;
  maxDate?: string;
  // Placeholder text
  placeholder?: string;
  // Help text shown below the input
  helpText?: string;
};

export type EntityFieldConfig = {
  entityType: EntityType;
  label: string;
  description: string;
  fields: FilterFieldDefinition[];
};

// ============================================================================
// Filter Results
// ============================================================================

export type TrackFilterResult = {
  isrc: string;
  name: string;
  release_date: string | null;
  spotify_artist_names: string[];
  spotify_artist_ids: string[];
  total_streams: number;
  daily_streams: number | null;
  spotify_track_id: string | null;
  spotify_album_image_url: string | null;
};

export type ArtistFilterResult = {
  artist_id: string;
  artist_name: string;
  total_streams: number;
  track_count: number;
  image_url: string | null;
};

export type PlaylistFilterResult = {
  playlist_key: string;
  display_name: string;
  track_count: number;
  total_streams: number;
  daily_streams: number | null;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_image_url: string | null;
};

export type FilterResult = TrackFilterResult | ArtistFilterResult | PlaylistFilterResult;

// ============================================================================
// UI State Types
// ============================================================================

export type FilterBuilderState = {
  isOpen: boolean;
  activeFilter: FilterConfig | null;
  savedFilters: FilterConfig[];
  results: FilterResult[];
  isLoading: boolean;
  error: string | null;
  resultsCount: number | null;
};

// ============================================================================
// Utility Types
// ============================================================================

export function createEmptyCondition(): FilterCondition {
  return {
    id: crypto.randomUUID(),
    field: "",
    operator: "eq",
    value: null,
    enabled: true,
  };
}

export function createEmptyGroup(logic: FilterGroupLogic = "AND"): FilterGroup {
  return {
    id: crypto.randomUUID(),
    logic,
    conditions: [createEmptyCondition()],
  };
}

export function createEmptyFilter(entityType: EntityType = "tracks"): FilterConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    entityType,
    groups: [createEmptyGroup()],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
