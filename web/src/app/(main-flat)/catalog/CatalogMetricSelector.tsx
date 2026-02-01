"use client";

import { Chip, ChipGroup } from "@/components/ui/Chip";

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
    <ChipGroup segmented>
      {METRICS.map((m) => (
        <Chip key={m} segmented selected={metric === m} onClick={() => setMetric(m)}>
          {m === "revenue" ? "Revenue" : m === "streams" ? "Streams" : "Tracks"}
        </Chip>
      ))}
    </ChipGroup>
  );
}
