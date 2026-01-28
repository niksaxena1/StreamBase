"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { type Metric } from "./PlaylistMetricSelector";

const PlaylistMetricContext = createContext<{
  metric: Metric;
  setMetric: (metric: Metric) => void;
} | null>(null);

export function PlaylistMetricProvider({ children }: { children: ReactNode }) {
  const [metric, setMetric] = useState<Metric>("streams");
  return (
    <PlaylistMetricContext.Provider value={{ metric, setMetric }}>
      {children}
    </PlaylistMetricContext.Provider>
  );
}

export function usePlaylistMetric() {
  const context = useContext(PlaylistMetricContext);
  if (!context) {
    throw new Error("usePlaylistMetric must be used within PlaylistMetricProvider");
  }
  return context;
}
