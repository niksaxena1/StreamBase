// Shared app-wide constants.
// Prefer importing from here instead of hardcoding literals.

// Cache TTLs (in seconds)
export const CACHE_TTL_5MIN = 300;
export const CACHE_TTL_1H = 3600;
export const CACHE_TTL_24H = 86400;

// Supabase timing
export const SB_TIMING_SLOW_MS_DEFAULT = 250;

// Query limits and pagination
export const QUERY_LIMIT_DEFAULT = 5000;
export const QUERY_LIMIT_OVERRIDES = 500;
export const QUERY_LIMIT_WARNINGS = 2000;
export const QUERY_LIMIT_TRACK_META = 2000;
export const QUERY_LIMIT_MEMBERSHIPS = 5000;
export const PAGE_SIZE_DEFAULT = 1000;
export const DRILL_PAGE_SIZE_DEFAULT = 50;

// Date / range
export const MAX_RANGE_DAYS = 365;
export const MS_PER_DAY = 86_400_000; // 1000 * 60 * 60 * 24

// UI timing
export const SAVED_FEEDBACK_MS = 2000;
export const TOAST_DISPLAY_MS = 2500;
export const TOAST_REMOVE_DELAY_MS = 220;

// RapidAPI
export const RAPIDAPI_RATE_LIMIT_MS = 1100;

// Chart layout
export const CHART_HEIGHT_DEFAULT = 220;

// Stale track defaults
export const DEFAULT_STALE_MIN_STREAMS = 2000;

// Currency
export const DEFAULT_CURRENCY = "USD" as const;

// API-specific limits
export const API_LOOKUP_DROPDOWN_MAX = 10_000;
export const API_LOOKUP_THUMBNAILS_MAX = 800;
export const API_LOOKUP_PAGE_SIZE = 1000;
export const API_LOOKUP_TRACK_MAX = 5000;
export const API_LOOKUP_LIMIT_500 = 500;

