"use client";

import { useMemo, useSyncExternalStore } from "react";
import { LIBRARY_COLUMNS_STORAGE_KEY, parseHiddenColumns, type LibraryColumnId } from "./columns";

const changed = "sb:library:columns-changed";
let fallbackRaw: string | null = null;

function read() {
  if (fallbackRaw !== null) return fallbackRaw;
  try {
    return window.localStorage.getItem(LIBRARY_COLUMNS_STORAGE_KEY) ?? fallbackRaw;
  } catch {
    return fallbackRaw;
  }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === LIBRARY_COLUMNS_STORAGE_KEY || event.key === null) {
      fallbackRaw = null;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changed, notify);
  };
}

export function useLibraryColumns() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const hidden = useMemo(() => parseHiddenColumns(raw), [raw]);
  function setHidden(next: LibraryColumnId[]) {
    fallbackRaw = JSON.stringify(next);
    try {
      window.localStorage.setItem(LIBRARY_COLUMNS_STORAGE_KEY, fallbackRaw);
      fallbackRaw = null;
    } catch {
      // Keep the picker usable for this session when browser storage is unavailable.
    }
    window.dispatchEvent(new Event(changed));
  }
  return { hidden, setHidden };
}
