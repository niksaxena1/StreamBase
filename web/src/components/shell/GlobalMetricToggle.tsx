"use client";

import { DollarSign, Music, Play } from "lucide-react";

import { useMetric } from "@/components/metrics/MetricContext";
import type { Metric } from "@/components/metrics/MetricSelector";
import { IconButton } from "@/components/ui/Button";

const ORDER: Metric[] = ["streams", "revenue", "tracks"];

function nextMetric(m: Metric): Metric {
  const i = ORDER.indexOf(m);
  return ORDER[(i + 1) % ORDER.length] ?? "streams";
}

function label(m: Metric) {
  return m === "streams" ? "Streams" : m === "revenue" ? "Revenue" : "Tracks";
}

export function GlobalMetricToggle() {
  const { metric, setMetric } = useMetric();
  const next = nextMetric(metric);

  const Icon = metric === "streams" ? Play : metric === "revenue" ? DollarSign : Music;

  return (
    <IconButton
      type="button"
      variant="ghost"
      onClick={() => setMetric(next)}
      aria-label={`Metric: ${label(metric)}. Click to switch to ${label(next)}.`}
      title={`Metric: ${label(metric)} (click to switch)`}
    >
      <span className="inline-flex" suppressHydrationWarning>
        <Icon className="h-4 w-4" />
      </span>
    </IconButton>
  );
}

