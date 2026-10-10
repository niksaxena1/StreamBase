import { useCallback, useSyncExternalStore } from "react";

/** Per-viewer chart preferences. Storage is optional: every read/write tolerates failure. */
const KEY = "streambase-legacy-chart-weekends";
const EVENT = "streambase-legacy-prefs";
let memory: boolean | null = null; // survives blocked storage for this session
export function readWeekendPref(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored !== "off";
  } catch {
    /* fall back to memory */
  }
  return memory ?? true;
}
export function writeWeekendPref(show: boolean): void {
  memory = show;
  try {
    localStorage.setItem(KEY, show ? "on" : "off");
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
/** Weekend shading preference, default on, shared by every daily chart. */
export function useWeekendShading() {
  const show = useSyncExternalStore(subscribe, readWeekendPref, () => true);
  return [show, useCallback((value: boolean) => writeWeekendPref(value), [])] as const;
}
