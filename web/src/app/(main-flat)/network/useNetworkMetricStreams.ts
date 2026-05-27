"use client";

import { useCallback } from "react";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

/**
 * Global metric toggle (streams / revenue / tracks). Tracks is treated as streams for stream-derived values.
 * APIs always return stream counts; revenue multiplies by payout rate for display and sort.
 */
export function useNetworkMetricStreams() {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const displayMetric = metric === "tracks" ? "streams" : metric;
  const metricColor =
    metric === "revenue"
      ? "#10b981"
      : metric === "tracks"
        ? "#3b82f6"
        : "var(--sb-accent)";

  const formatFromStreamCount = useCallback(
    (streamCount: number | null | undefined) => {
      if (streamCount == null) return "—";
      if (displayMetric === "revenue") {
        return formatUsd2(streamCount * streamPayoutPerStreamUsd);
      }
      return formatInt(streamCount);
    },
    [displayMetric, streamPayoutPerStreamUsd],
  );

  const sortKeyFromStreamCount = useCallback(
    (streamCount: number | null | undefined): number | null => {
      if (streamCount == null) return null;
      if (displayMetric === "revenue") {
        return streamCount * streamPayoutPerStreamUsd;
      }
      return streamCount;
    },
    [displayMetric, streamPayoutPerStreamUsd],
  );

  const totalColumnLabel =
    displayMetric === "revenue" ? "Total revenue" : "Total streams";
  const dailyColumnLabel =
    displayMetric === "revenue" ? "Daily revenue" : "Daily streams";

  return {
    displayMetric,
    metricColor,
    formatFromStreamCount,
    sortKeyFromStreamCount,
    totalColumnLabel,
    dailyColumnLabel,
  };
}
