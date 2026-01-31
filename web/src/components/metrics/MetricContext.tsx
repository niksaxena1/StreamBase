"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Metric } from "./MetricSelector";

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
  return (
    <MetricContext.Provider value={{ metric, setMetric }}>
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

