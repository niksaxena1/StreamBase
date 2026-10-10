import { useCallback, useSyncExternalStore } from "react";

/**
 * App-wide number display: "exact" (1,234,567) or "compact" (1.2M). Per-viewer preference; storage is
 * optional (blocked storage falls back to memory for the session). Charts keep compact axes.
 */
export type NumberMode = "compact" | "exact";
const KEY = "streambase-legacy-number-mode";
const EVENT = "streambase-legacy-number-mode";
let memory: NumberMode | null = null;
export function readNumberMode(): NumberMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "compact" || stored === "exact") return stored;
  } catch {
    /* fall back to memory */
  }
  return memory ?? "exact";
}
export function writeNumberMode(mode: NumberMode): void {
  memory = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private/read-only storage */
  }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (callback: () => void) => {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
};
export function useNumberMode() {
  const mode = useSyncExternalStore(
    subscribe,
    readNumberMode,
    () => "exact" as const,
  );
  return [mode, useCallback((value: NumberMode) => writeNumberMode(value), [])] as const;
}
