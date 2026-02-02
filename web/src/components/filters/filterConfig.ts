/**
 * Filter Field Configuration
 * 
 * Defines all available fields for filtering tracks, artists, and playlists.
 */

import type { 
  EntityFieldConfig, 
  FilterFieldDefinition,
  NumberOperator,
  DateOperator,
  TextOperator,
  SelectOperator,
  BooleanOperator,
} from "./filterTypes";

// ============================================================================
// Operator Labels (for UI display)
// ============================================================================

export const NUMBER_OPERATOR_LABELS: Record<NumberOperator, string> = {
  eq: "equals",
  neq: "not equal to",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  between: "between",
};

export const DATE_OPERATOR_LABELS: Record<DateOperator, string> = {
  eq: "is",
  before: "before",
  after: "after",
  between: "between",
  month_is: "month is",
  year_is: "year is",
};

export const TEXT_OPERATOR_LABELS: Record<TextOperator, string> = {
  eq: "equals",
  neq: "not equal to",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
};

export const SELECT_OPERATOR_LABELS: Record<SelectOperator, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  not_in: "is none of",
};

export const BOOLEAN_OPERATOR_LABELS: Record<BooleanOperator, string> = {
  eq: "is",
};

export function getOperatorLabel(operator: string, fieldType: string): string {
  switch (fieldType) {
    case "number":
      return NUMBER_OPERATOR_LABELS[operator as NumberOperator] ?? operator;
    case "date":
      return DATE_OPERATOR_LABELS[operator as DateOperator] ?? operator;
    case "text":
      return TEXT_OPERATOR_LABELS[operator as TextOperator] ?? operator;
    case "select":
    case "multi-select":
      return SELECT_OPERATOR_LABELS[operator as SelectOperator] ?? operator;
    case "boolean":
      return BOOLEAN_OPERATOR_LABELS[operator as BooleanOperator] ?? operator;
    default:
      return operator;
  }
}

// ============================================================================
// Month Options (for month_is operator)
// ============================================================================

export const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

// ============================================================================
// Track Fields
// ============================================================================

const TRACK_FIELDS: FilterFieldDefinition[] = [
  {
    key: "total_streams",
    label: "Total Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Cumulative streams for the track",
    min: 0,
    placeholder: "e.g., 1000000",
    helpText: "Use K for thousands (e.g., 100K), M for millions (e.g., 5M)",
  },
  {
    key: "daily_streams",
    label: "Daily Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Most recent daily stream count",
    min: 0,
    placeholder: "e.g., 10000",
    helpText: "Daily stream delta from the latest data",
  },
  {
    key: "release_date",
    label: "Release Date",
    type: "date",
    operators: ["eq", "before", "after", "between", "month_is", "year_is"],
    description: "When the track was released",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "first_seen",
    label: "First Seen",
    type: "date",
    operators: ["eq", "before", "after", "between"],
    description: "When the track was first ingested",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "track_name",
    label: "Track Name",
    type: "text",
    operators: ["contains", "starts_with", "eq", "neq"],
    description: "The title of the track",
    placeholder: "Search track name...",
  },
  {
    key: "artist",
    label: "Artist",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Filter by artist (includes collaborators)",
    optionsSource: "artists",
    placeholder: "Select artists...",
    helpText: "Matches tracks where any credited artist matches",
  },
  {
    key: "playlist",
    label: "In Playlist",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Filter by playlist membership",
    optionsSource: "playlists",
    placeholder: "Select playlists...",
  },
];

// ============================================================================
// Artist Fields (derived from tracks)
// ============================================================================

const ARTIST_FIELDS: FilterFieldDefinition[] = [
  {
    key: "total_streams",
    label: "Total Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Sum of streams across all artist's tracks",
    min: 0,
    placeholder: "e.g., 10000000",
  },
  {
    key: "track_count",
    label: "Track Count",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Number of tracks by this artist",
    min: 1,
    placeholder: "e.g., 5",
  },
  {
    key: "artist_name",
    label: "Artist Name",
    type: "text",
    operators: ["contains", "starts_with", "eq", "neq"],
    description: "The artist's name",
    placeholder: "Search artist name...",
  },
  {
    key: "daily_streams",
    label: "Daily Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Sum of daily streams across all artist's tracks",
    min: 0,
    placeholder: "e.g., 50000",
  },
];

// ============================================================================
// Playlist Fields
// ============================================================================

const PLAYLIST_FIELDS: FilterFieldDefinition[] = [
  {
    key: "track_count",
    label: "Track Count",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Number of tracks in the playlist",
    min: 0,
    placeholder: "e.g., 50",
  },
  {
    key: "total_streams",
    label: "Total Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Sum of streams for all tracks",
    min: 0,
    placeholder: "e.g., 1000000",
  },
  {
    key: "daily_streams",
    label: "Daily Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Daily stream delta",
    min: 0,
    placeholder: "e.g., 10000",
  },
  {
    key: "display_name",
    label: "Playlist Name",
    type: "text",
    operators: ["contains", "starts_with", "eq", "neq"],
    description: "The playlist's display name",
    placeholder: "Search playlist name...",
  },
  {
    key: "is_catalog",
    label: "Is Catalog",
    type: "boolean",
    operators: ["eq"],
    description: "Whether this is a catalog playlist",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "playlist_type",
    label: "Playlist Type",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "The playlist classification",
    optionsSource: "collectors", // Will load playlist_type values
    placeholder: "Select type...",
  },
  {
    key: "collector",
    label: "Collector",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "The collector bucket",
    optionsSource: "collectors",
    placeholder: "Select collector...",
  },
];

// ============================================================================
// Entity Configurations
// ============================================================================

export const ENTITY_CONFIGS: Record<string, EntityFieldConfig> = {
  tracks: {
    entityType: "tracks",
    label: "Tracks",
    description: "Filter individual tracks by streams, dates, artists, and more",
    fields: TRACK_FIELDS,
  },
  artists: {
    entityType: "artists",
    label: "Artists",
    description: "Filter artists by aggregate track metrics",
    fields: ARTIST_FIELDS,
  },
  playlists: {
    entityType: "playlists",
    label: "Playlists",
    description: "Filter playlists by metrics and properties",
    fields: PLAYLIST_FIELDS,
  },
};

export function getFieldsForEntity(entityType: string): FilterFieldDefinition[] {
  return ENTITY_CONFIGS[entityType]?.fields ?? [];
}

export function getFieldDefinition(entityType: string, fieldKey: string): FilterFieldDefinition | undefined {
  const fields = getFieldsForEntity(entityType);
  return fields.find(f => f.key === fieldKey);
}

export function getDefaultOperator(fieldDef: FilterFieldDefinition): string {
  return fieldDef.operators[0] ?? "eq";
}

// ============================================================================
// Value Parsing Utilities
// ============================================================================

/**
 * Parse a user-entered number string, supporting K/M/B suffixes
 */
export function parseNumberValue(input: string): number | null {
  if (!input || typeof input !== "string") return null;
  
  const cleaned = input.trim().toLowerCase().replace(/,/g, "").replace(/_/g, "");
  if (!cleaned) return null;

  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) {
    // Try parsing as plain number
    const n = Number(input.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  const base = Number(match[1]);
  const suffix = match[2];
  
  const multiplier = 
    suffix === "k" ? 1_000 :
    suffix === "m" ? 1_000_000 :
    suffix === "b" ? 1_000_000_000 :
    1;

  const result = base * multiplier;
  return Number.isFinite(result) ? result : null;
}

/**
 * Format a number for display with K/M/B suffixes
 */
export function formatNumberValue(n: number): string {
  if (!Number.isFinite(n)) return "";
  
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return Number.isInteger(v) ? `${v}B` : `${v.toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`;
  }
  return String(n);
}
