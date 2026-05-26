"use client";

import { useMemo } from "react";

import { useCurrencyDisplay } from "@/components/currency/CurrencyDisplayContext";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd } from "@/lib/format";

export type StreamDisplayMetric = "streams" | "revenue";

export function scaleStreamsForDisplay(
  streams: number,
  displayMetric: StreamDisplayMetric,
  streamPayoutPerStreamUsd: number,
): number {
  if (displayMetric === "revenue") return streams * streamPayoutPerStreamUsd;
  return streams;
}

export function formatStreamMetricValue(value: number, displayMetric: StreamDisplayMetric): string {
  if (displayMetric === "revenue") return formatUsd(value);
  return formatInt(value);
}

export function formatStreamMetricDelta(delta: number | null, displayMetric: StreamDisplayMetric): string | null {
  if (delta == null || delta === 0) return null;
  if (delta > 0) return `+${formatStreamMetricValue(delta, displayMetric)}`;
  return formatStreamMetricValue(delta, displayMetric);
}

export function streamMetricDeltaColor(delta: number | null): string {
  if (delta == null || delta === 0) return "var(--sb-muted)";
  if (delta > 0) return "var(--sb-positive)";
  return "var(--sb-negative, #ef4444)";
}

export function streamMetricValueStyle(displayMetric: StreamDisplayMetric): { color: string } | undefined {
  if (displayMetric === "revenue") return { color: "#10b981" };
  return { color: "var(--sb-positive)" };
}

/** Global streams/revenue metric for competitor stream counts (tracks metric → streams). */
export function useCompetitorStreamMetric() {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  useCurrencyDisplay();

  const displayMetric: StreamDisplayMetric = metric === "revenue" ? "revenue" : "streams";

  return useMemo(
    () => ({
      displayMetric,
      streamPayoutPerStreamUsd,
      dailyColumnLabel: displayMetric === "revenue" ? "Daily rev" : "Daily",
      scale: (streams: number) => scaleStreamsForDisplay(streams, displayMetric, streamPayoutPerStreamUsd),
      format: (streams: number) =>
        formatStreamMetricValue(
          scaleStreamsForDisplay(streams, displayMetric, streamPayoutPerStreamUsd),
          displayMetric,
        ),
      formatDelta: (streamDelta: number | null) => {
        if (streamDelta == null) return null;
        const scaled = scaleStreamsForDisplay(streamDelta, displayMetric, streamPayoutPerStreamUsd);
        return formatStreamMetricDelta(scaled, displayMetric);
      },
      deltaColor: (streamDelta: number | null) => {
        if (streamDelta == null) return streamMetricDeltaColor(null);
        const scaled = scaleStreamsForDisplay(streamDelta, displayMetric, streamPayoutPerStreamUsd);
        return streamMetricDeltaColor(scaled);
      },
      valueStyle: streamMetricValueStyle(displayMetric),
    }),
    [displayMetric, streamPayoutPerStreamUsd],
  );
}

export function CompetitorStreamMetricCell({
  value,
  delta,
  className,
}: {
  value: number;
  delta?: number | null;
  className?: string;
}) {
  const streamMetric = useCompetitorStreamMetric();
  return (
    <div className={className}>
      <div className="font-medium" style={streamMetric.valueStyle}>
        {streamMetric.format(value)}
      </div>
      {delta != null && streamMetric.formatDelta(delta) ? (
        <div className="text-[10px] font-normal" style={{ color: streamMetric.deltaColor(delta) }}>
          {streamMetric.formatDelta(delta)}
        </div>
      ) : null}
    </div>
  );
}
