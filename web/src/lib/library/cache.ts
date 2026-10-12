/** Cache tag shared by every library read; edits expire it. */
export const LIBRARY_CACHE_TAG = "catalog";

/** Short on purpose: the catalog is also changed outside the app. */
export const LIBRARY_CACHE_TTL_S = 60;
