"use client";

import { useCallback, useSyncExternalStore } from "react";

const eventName = (key: string) => `sb:stored-bool:${key}`;

export function useStoredBoolState(key: string, defaultValue = false) {
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === key) notify(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(eventName(key), notify);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName(key), notify); };
  }, [key]);
  const getSnapshot = useCallback(() => {
    try {
      const value = localStorage.getItem(key);
      if (value === "1" || value === "true") return true;
      if (value === "0" || value === "false") return false;
    } catch { /* unavailable */ }
    return defaultValue;
  }, [defaultValue, key]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);
  const setValue = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(getSnapshot()) : next;
    try { localStorage.setItem(key, resolved ? "1" : "0"); } catch { /* unavailable */ }
    window.dispatchEvent(new Event(eventName(key)));
  }, [getSnapshot, key]);
  return [value, setValue] as const;
}
