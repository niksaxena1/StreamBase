"use client";

import { useState } from "react";

const METRICS = ["streams", "revenue", "tracks"] as const;
export type Metric = (typeof METRICS)[number];

export function CatalogMetricSelector({
  metric,
  setMetric,
}: {
  metric: Metric;
  setMetric: (metric: Metric) => void;
}) {
  return (
    <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 dark:bg-white/10">
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMetric(m)}
          className={[
            "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
            metric === m
              ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
              : "hover:bg-white/70 dark:hover:bg-white/10",
          ].join(" ")}
          style={metric === m ? undefined : { color: "var(--sb-muted)" }}
        >
          {m === "revenue" ? "Revenue" : m === "streams" ? "Streams" : "Tracks"}
        </button>
      ))}
    </div>
  );
}
