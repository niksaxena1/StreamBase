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
  last_n_days: "in the last",
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
    placeholder: "e.g., 10000",
    helpText: "Daily stream delta from the latest data (can be negative for corrections)",
  },
  {
    key: "release_date",
    label: "Release Date",
    type: "date",
    operators: ["eq", "before", "after", "between", "last_n_days", "month_is", "year_is"],
    description: "When the track was released",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "first_seen",
    label: "First Seen",
    type: "date",
    operators: ["eq", "before", "after", "between", "last_n_days", "month_is", "year_is"],
    description: "When the track first appeared in the catalog",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "last_seen",
    label: "Last Seen",
    type: "date",
    operators: ["eq", "before", "after", "between", "last_n_days", "month_is", "year_is"],
    description: "When the track was last seen in the catalog",
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
  {
    key: "collector",
    label: "Collector",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "Filter tracks by which collector's playlists they appear in",
    options: [
      { value: "A", label: "A" },
      { value: "K", label: "K" },
      { value: "N", label: "N" },
      { value: "PL", label: "PL" },
      { value: "TG", label: "TG" },
      { value: "NL", label: "NL" },
    ],
    placeholder: "Select collector...",
    helpText: "Matches tracks in at least one playlist belonging to this collector",
  },
  {
    key: "isrc",
    label: "ISRC",
    type: "text",
    operators: ["eq", "contains", "starts_with"],
    description: "International Standard Recording Code",
    placeholder: "e.g., USRC12345678",
    helpText: "Exact match or partial search on the track ISRC",
  },
  {
    key: "has_spotify_id",
    label: "Has Spotify Link",
    type: "boolean",
    operators: ["eq"],
    description: "Whether the track has been enriched with a Spotify ID",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "is_collaboration",
    label: "Is Collaboration",
    type: "boolean",
    operators: ["eq"],
    description: "Tracks credited to two or more artists",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "est_total_revenue",
    label: "Est. Total Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated cumulative revenue based on payout rate",
    min: 0,
    placeholder: "e.g., 500",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "est_daily_revenue",
    label: "Est. Daily Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated daily revenue based on payout rate",
    min: 0,
    placeholder: "e.g., 10",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "in_multiple_distro",
    label: "In Multiple Distro Playlists",
    type: "boolean",
    operators: ["eq"],
    description: "Track appears in more than one Distro playlist (data error)",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Useful for catching tracks that were accidentally added to multiple Distro playlists",
  },
  {
    key: "in_multiple_entity",
    label: "In Multiple Entity Playlists",
    type: "boolean",
    operators: ["eq"],
    description: "Track appears in more than one Entity playlist (data error)",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Useful for catching tracks that were accidentally added to multiple Entity playlists",
  },
  {
    key: "moved_distro",
    label: "Moved Between Distro Playlists",
    type: "boolean",
    operators: ["eq"],
    description: "Track has been in 2+ different Distro playlists historically",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Uses the movement date range; default is all-time",
  },
  {
    key: "moved_entity",
    label: "Moved Between Entity Playlists",
    type: "boolean",
    operators: ["eq"],
    description: "Track has been in 2+ different Entity playlists historically",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Uses the movement date range; default is all-time",
  },
  {
    key: "has_duplicate_title",
    label: "Has Duplicate Title",
    type: "boolean",
    operators: ["eq"],
    description: "Track shares its exact title (case-insensitive) with another track in the catalog",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "artist_count",
    label: "Number of Artists",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte"],
    description: "Number of credited artists (1 = solo, 2+ = collaboration)",
  },
  {
    key: "days_since_release",
    label: "Days Since Release",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Number of days since the track was released",
  },
  {
    key: "in_any_playlist",
    label: "In Any Playlist",
    type: "boolean",
    operators: ["eq"],
    description: "Whether the track is currently in at least one playlist",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Useful for finding orphaned tracks not assigned to any playlist",
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
    key: "is_in_house",
    label: "Is In-House",
    type: "boolean",
    operators: ["eq"],
    description: "Whether the artist is tagged as In-House in Catalog Config",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
    helpText: "Artists are NIH unless they have been tagged In-House",
  },
  {
    key: "daily_streams",
    label: "Daily Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Sum of daily streams across all artist's tracks",
    placeholder: "e.g., 50000",
  },
  {
    key: "playlist",
    label: "In Playlist",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Filter artists by whether they have tracks in selected playlists",
    optionsSource: "playlists",
    placeholder: "Select playlists...",
    helpText: "Matches artists if any of their tracks are (or are not) in these playlists",
  },
  {
    key: "collector",
    label: "Collector",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "Filter artists by which collector's playlists their tracks appear in",
    options: [
      { value: "A", label: "A" },
      { value: "K", label: "K" },
      { value: "N", label: "N" },
      { value: "PL", label: "PL" },
      { value: "TG", label: "TG" },
      { value: "NL", label: "NL" },
    ],
    placeholder: "Select collector...",
    helpText: "Matches artists with at least one track in a playlist belonging to this collector",
  },
  {
    key: "avg_streams_per_track",
    label: "Avg Streams / Track",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Average cumulative streams per track for the artist",
    min: 0,
    placeholder: "e.g., 500000",
    helpText: "Total streams divided by number of tracks",
  },
  {
    key: "has_track_named",
    label: "Has Track Named",
    type: "text",
    operators: ["contains", "starts_with", "eq", "neq"],
    description: "Filter artists who have a track matching this name",
    placeholder: "Search track name...",
    helpText: "Matches if any of the artist's tracks match",
  },
  {
    key: "est_total_revenue",
    label: "Est. Total Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated total revenue across all tracks",
    min: 0,
    placeholder: "e.g., 2000",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "est_daily_revenue",
    label: "Est. Daily Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated daily revenue across all tracks",
    min: 0,
    placeholder: "e.g., 50",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "first_seen",
    label: "First Seen",
    type: "date",
    operators: ["eq", "before", "after", "between", "last_n_days", "month_is", "year_is"],
    description: "Earliest first-seen date across the artist's tracks",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "last_seen",
    label: "Last Seen",
    type: "date",
    operators: ["eq", "before", "after", "between", "last_n_days", "month_is", "year_is"],
    description: "Latest last-seen date across the artist's tracks",
    placeholder: "YYYY-MM-DD",
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
    key: "playlist_type",
    label: "Playlist Type",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "The playlist classification",
    options: [
      { value: "Catalog", label: "Catalog" },
      { value: "Label", label: "Label" },
      { value: "Entity", label: "Entity" },
      { value: "Distro", label: "Distro" },
    ],
    placeholder: "Select type...",
  },
  {
    key: "collector",
    label: "Collector",
    type: "select",
    operators: ["eq", "neq", "in"],
    description: "The collector bucket",
    options: [
      { value: "A", label: "A" },
      { value: "K", label: "K" },
      { value: "N", label: "N" },
      { value: "PL", label: "PL" },
      { value: "TG", label: "TG" },
      { value: "NL", label: "NL" },
    ],
    placeholder: "Select collector...",
  },
  {
    key: "est_total_revenue",
    label: "Est. Total Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated cumulative revenue for the playlist",
    min: 0,
    placeholder: "e.g., 2000",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "est_daily_revenue",
    label: "Est. Daily Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated daily revenue for the playlist",
    min: 0,
    placeholder: "e.g., 50",
    helpText: "Uses your configured payout rate (Settings)",
  },
  {
    key: "est_monthly_revenue",
    label: "Est. Monthly Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Estimated monthly revenue (daily revenue × 30)",
    min: 0,
    placeholder: "e.g., 1500",
    helpText: "Projection based on the latest daily streams × payout rate × 30 days",
  },
  {
    key: "contains_track",
    label: "Contains Track",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Filter playlists that contain (or don't contain) specific tracks",
    optionsSource: "tracks",
    placeholder: "Select tracks...",
    helpText: "Requires an active data date; searches memberships on that date",
  },
  {
    key: "contains_artist",
    label: "Contains Artist",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Filter playlists that contain tracks by specific artists",
    optionsSource: "artists",
    placeholder: "Select artists...",
    helpText: "Matches playlists containing any track credited to these artists",
  },
];

// ============================================================================
// Date Fields (daily catalog-wide aggregates)
// ============================================================================

export const DAY_OF_WEEK_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const DATE_FIELDS: FilterFieldDefinition[] = [
  {
    key: "daily_streams",
    label: "Daily Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Total daily stream delta across catalog",
    placeholder: "e.g., 50000",
  },
  {
    key: "growth_pct",
    label: "Daily Growth %",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between"],
    description: "Percentage change in daily streams vs previous day",
    placeholder: "e.g., 10",
    helpText: "Positive = growth, negative = decline. 10 means +10%",
  },
  {
    key: "track_count",
    label: "Track Count",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Total active tracks in catalog on this date",
    min: 0,
    placeholder: "e.g., 200",
  },
  {
    key: "tracks_added",
    label: "Tracks Added / Removed",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Net change in track count from previous day",
    placeholder: "e.g., 5",
    helpText: "Positive = tracks added, negative = tracks removed",
  },
  {
    key: "cumulative_streams",
    label: "Cumulative Streams",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between"],
    description: "Total cumulative streams across catalog on this date",
    min: 0,
    placeholder: "e.g., 10000000",
  },
  {
    key: "est_daily_revenue",
    label: "Est. Daily Revenue",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between"],
    description: "Estimated daily revenue in USD",
    min: 0,
    placeholder: "e.g., 100",
    helpText: "Based on the configured payout rate",
  },
  {
    key: "streams_per_track",
    label: "Streams per Track",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Average daily streams per active track",
    min: 0,
    placeholder: "e.g., 250",
    helpText: "Daily streams divided by track count",
  },
  {
    key: "moving_avg_7d",
    label: "7-Day Moving Avg",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between"],
    description: "Trailing 7-day moving average of daily streams",
    min: 0,
    placeholder: "e.g., 40000",
    helpText: "Smooths out day-to-day noise; null for the first 6 days",
  },
  {
    key: "wow_growth_pct",
    label: "Week-over-Week Growth %",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between"],
    description: "Change vs same day 7 days ago",
    placeholder: "e.g., 15",
    helpText: "More meaningful than day-over-day for spotting real trends",
  },
  {
    key: "is_weekend",
    label: "Is Weekend",
    type: "boolean",
    operators: ["eq"],
    description: "Saturday or Sunday",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "missing_streams_count",
    label: "Missing Streams Count",
    type: "number",
    operators: ["gt", "gte", "lt", "lte", "between", "eq"],
    description: "Number of tracks with missing stream data on this date",
    min: 0,
    placeholder: "e.g., 5",
    helpText: "Higher values may indicate incomplete data ingestion",
  },
  {
    key: "day_of_week",
    label: "Day of Week",
    type: "select",
    operators: ["eq", "neq", "in"],
    options: DAY_OF_WEEK_OPTIONS,
    description: "Filter by day of week",
    placeholder: "Select day...",
  },
  {
    key: "date",
    label: "Date",
    type: "date",
    operators: ["eq", "before", "after", "between"],
    description: "Filter to a specific date range",
    placeholder: "YYYY-MM-DD",
  },
];

// ============================================================================
// Network graph artists (client-side on collaboration graph payload only;
// not listed in home FilterBuilder — use getFieldsForEntity("network_artists").)
// ============================================================================

const NETWORK_ARTIST_FIELDS: FilterFieldDefinition[] = [
  {
    key: "artist_name",
    label: "Artist name",
    type: "text",
    operators: ["contains", "not_contains", "starts_with", "eq", "neq"],
    description: "Display name on the graph",
    placeholder: "Search…",
  },
  {
    key: "track_count",
    label: "In-scope tracks (graph)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Track count from the collaboration graph for the current scope",
    min: 0,
    placeholder: "e.g., 5",
  },
  {
    key: "co_artists_playlist",
    label: "Co-artists (playlist credits)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Distinct other artists on the same scoped track (any credit)",
    min: 0,
    placeholder: "e.g., 3",
  },
  {
    key: "co_artists_lead",
    label: "Co-artists (lead rows)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Co-artists only on tracks where this artist is primary",
    min: 0,
    placeholder: "e.g., 1",
  },
  {
    key: "graph_collab_links",
    label: "Collab links (graph edges)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Number of collaboration edges in the loaded graph (co-primary links when hide-non-primary is on)",
    min: 0,
    placeholder: "e.g., 2",
  },
  {
    key: "collab_partner",
    label: "Collab partner on graph",
    type: "multi-select",
    operators: ["in", "not_in"],
    description: "Whether this artist shares a graph edge with any selected artist",
    optionsSource: "network_nodes",
    placeholder: "Select artists…",
    helpText:
      "“Is any of” = has at least one collaboration link to a selected artist. “Is none of” = no link to any of them. Only artists in the current graph appear here.",
  },
  {
    key: "streams_total_scope",
    label: "Total streams (in scope)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Cumulative streams for deduped in-scope tracks (same rules as network export)",
    min: 0,
    placeholder: "e.g., 1M",
    helpText:
      "Loads from the server when this filter is active. Uses latest cumulative day in your data. Respects current playlist scope and hide-non-primary.",
  },
  {
    key: "streams_daily_scope",
    label: "Daily streams (in scope)",
    type: "number",
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    description: "Sum of latest daily deltas for in-scope tracks",
    min: 0,
    placeholder: "e.g., 10K",
    helpText: "Same data source as total streams; day-over-day delta from stream history.",
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
  dates: {
    entityType: "dates",
    label: "Dates",
    description: "Filter days by catalog-wide daily metrics, growth, and track changes",
    fields: DATE_FIELDS,
  },
};

export function getFieldsForEntity(entityType: string): FilterFieldDefinition[] {
  if (entityType === "network_artists") return NETWORK_ARTIST_FIELDS;
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
