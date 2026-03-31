/** localStorage key for persisted camera (zoom / center). */
export const LS_NETWORK_CAMERA = "sb:network:camera:v1";

/** localStorage key: `"0"` = hide world-space background grid; default (missing) = show. */
export const LS_NETWORK_SHOW_GRID = "sb:network:showGrid:v1";

export function readNetworkShowGridFromStorage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(LS_NETWORK_SHOW_GRID) !== "0";
  } catch {
    return true;
  }
}

/** Production site for Excel export links (catalog URLs, Summary page URL) — not the dev server origin. */
export const SPOTIBASE_PUBLIC_ORIGIN = "https://spotibase.vercel.app";

/** Max selected artist ids serialized in URL (`sel`). */
export const MAX_SEL_URL = 80;

export const CAMERA_SAVE_MS = 450;

/** Match `TrackStreamsXYChart`: touch/pen hold before box-select; movement cancels (user is panning). */
export const NETWORK_LONG_PRESS_MS = 550;
export const NETWORK_LONG_PRESS_MOVE_PX = 10;

/** Target on-screen spacing between major grid lines (px); cap line count for perf. */
export const NETWORK_GRID_TARGET_PX = 34;
export const NETWORK_GRID_MAX_LINES_PER_AXIS = 52;
/** Minor subdivisions (1/5 of major); only when spacing is comfortable and line count stays bounded. */
export const NETWORK_GRID_MINOR_MIN_PX = 12;
export const NETWORK_GRID_MINOR_MAX_PX = 30;
export const NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS = 56;

/** Synthetic combobox values for scope (not real playlist keys). */
export const SCOPE_CATALOG = "__scope_catalog__";
export const SCOPE_CUSTOM = "__scope_custom__";
