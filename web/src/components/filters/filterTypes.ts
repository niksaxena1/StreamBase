/**
 * Filter Builder Type Definitions
 * 
 * A dynamic query builder system for filtering tracks, artists, and playlists
 * without writing code.
 */

// ============================================================================
// Core Filter Types
// ============================================================================

export type EntityType = "tracks" | "artists" | "playlists" | "dates";

export type FieldType = "number" | "date" | "text" | "select" | "multi-select" | "boolean";

export type NumberOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";
export type DateOperator = "eq" | "before" | "after" | "between" | "month_is" | "year_is" | "last_n_days";
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
  optionsSource?: "artists" | "playlists" | "tracks";
  // For number fields
  min?: number;
  max?: number;
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
  first_seen: string | null;
  last_seen: string | null;
  spotify_artist_names: string[];
  spotify_artist_ids: string[];
  total_streams: number;
  daily_streams: number | null;
  spotify_track_id: string | null;
  spotify_album_image_url: string | null;
  in_multiple_distro: boolean;
  in_multiple_entity: boolean;
  moved_distro_playlists: { name: string; imageUrl: string | null }[] | null;
  moved_entity_playlists: { name: string; imageUrl: string | null }[] | null;
  has_duplicate_title: boolean;
};

export type ArtistFilterResult = {
  artist_id: string;
  artist_name: string;
  total_streams: number;
  track_count: number;
  daily_streams: number | null;
  avg_streams_per_track: number;
  image_url: string | null;
  first_seen: string | null;
  last_seen: string | null;
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
  est_total_revenue: number;
  est_daily_revenue: number | null;
  est_monthly_revenue: number | null;
};

export type DateFilterResult = {
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

export type FilterResult = TrackFilterResult | ArtistFilterResult | PlaylistFilterResult | DateFilterResult;

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
