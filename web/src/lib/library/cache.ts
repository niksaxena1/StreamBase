/** Cache tag shared by every library read; edits expire it. */
export const LIBRARY_CACHE_TAG = "catalog";

/** Short on purpose: the catalog is also changed outside the app. */
export const LIBRARY_CACHE_TTL_S = 60;

/** Stream totals live under their own tag: edits to releases do not change them. */
export const LIBRARY_STREAMS_CACHE_TAG = "catalog-streams";

/** Streams change once a day. */
export const LIBRARY_STREAMS_CACHE_TTL_S = 3600;
