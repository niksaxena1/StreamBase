"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Metric } from "./MetricSelector";

const STORAGE_KEY = "sb:metric";

function isMetric(v: unknown): v is Metric {
  return v === "streams" || v === "revenue" || v === "tracks";
}

const MetricContext = createContext<{
  metric: Metric;
  setMetric: (metric: Metric) => void;
} | null>(null);

export function MetricProvider({
  children,
  defaultMetric = "streams",
}: {
  children: ReactNode;
  defaultMetric?: Metric;
}) {
  const [metric, setMetric] = useState<Metric>(defaultMetric);

  // Restore persisted metric after mount (client-only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (isMetric(v) && v !== metric) setMetric(v);
    } catch {
      // ignore (private mode, disabled storage, etc.)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist metric changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, metric);
    } catch {
      // ignore
    }
  }, [metric]);

  const value = useMemo(() => ({ metric, setMetric }), [metric, setMetric]);

  return (
    <MetricContext.Provider value={value}>
      {children}
    </MetricContext.Provider>
  );
}

export function useMetric() {
  const context = useContext(MetricContext);
  if (!context) {
    throw new Error("useMetric must be used within MetricProvider");
  }
  return context;
}

