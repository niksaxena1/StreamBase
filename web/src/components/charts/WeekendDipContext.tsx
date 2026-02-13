"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type WeekendDipState = {
  /** Whether to show weekend dip % labels and tooltip info. */
  showWeekendDip: boolean;
  setShowWeekendDip: (v: boolean) => void;
};

const STORAGE_KEY = "sb:chart-show-weekend-dip";
const DEFAULT_SHOW = true;

const WeekendDipContext = createContext<WeekendDipState | null>(null);

function readStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {
    // SSR or storage unavailable
  }
  return DEFAULT_SHOW;
}

export function WeekendDipProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(DEFAULT_SHOW);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setShow(readStorage());
  }, []);

  const setShowWeekendDip = useCallback((v: boolean) => {
    setShow(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("sb:weekend-dip-updated"));
  }, []);

  // Listen for changes from other tabs / settings page
  useEffect(() => {
    function onUpdated() {
      setShow(readStorage());
    }
    window.addEventListener("sb:weekend-dip-updated", onUpdated);
    window.addEventListener("storage", onUpdated);
    return () => {
      window.removeEventListener("sb:weekend-dip-updated", onUpdated);
      window.removeEventListener("storage", onUpdated);
    };
  }, []);

  const value = useMemo<WeekendDipState>(
    () => ({ showWeekendDip: show, setShowWeekendDip }),
    [show, setShowWeekendDip],
  );

  return <WeekendDipContext.Provider value={value}>{children}</WeekendDipContext.Provider>;
}

export function useWeekendDip() {
  const ctx = useContext(WeekendDipContext);
  if (!ctx) throw new Error("useWeekendDip must be used within WeekendDipProvider");
  return ctx;
}
