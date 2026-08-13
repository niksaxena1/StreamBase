"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { formatKmbTick } from "@/components/charts/chartUtils";
import { getChartTooltipStyle, useThemeColors } from "@/components/charts/useThemeColors";
import { formatInt } from "@/lib/format";
import { isOwnCatalogLabelKey } from "@/lib/competitors/ownCatalog";

import {
  buildBenchmarkRows,
  buildShareRows,
  type BenchmarkMode,
} from "./competitorWorkspaceAnalytics";
import type { LabelDailyPoint, LabelRow } from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

const MODE_LABEL: Record<BenchmarkMode, string> = {
  absolute: "Absolute",
  indexed: "Indexed 100",
  per_track: "Per track",
  median_growth: "Growth vs median",
};

function formatBenchmarkValue(value: number, mode: BenchmarkMode): string {
  if (mode === "absolute") return formatInt(Math.round(value));
  if (mode === "per_track") return `${formatInt(Math.round(value))} / track`;
  if (mode === "indexed") return value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

export function CompetitorComparisonInsights({
  labels,
  labelSeries,
}: {
  labels: LabelRow[];
  labelSeries: LabelDailyPoint[];
}) {
  const colors = useThemeColors();
  const tooltipStyle = getChartTooltipStyle(colors);
  const searchParams = useSearchParams();
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("indexed");
  const activeLabels = useMemo(() => labels.filter((label) => label.is_active !== false), [labels]);
  const selectedLabels = useMemo(() => {
    const fromUrl = String(searchParams.get("labels") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const valid = fromUrl.filter((key) => activeLabels.some((label) => label.label_key === key));
    return valid.length ? valid : activeLabels.map((label) => label.label_key);
  }, [activeLabels, searchParams]);
  const selectedRows = useMemo(
    () => activeLabels.filter((label) => selectedLabels.includes(label.label_key)),
    [activeLabels, selectedLabels],
  );
  const competitorLabels = useMemo(
    () => selectedRows.filter((label) => !isOwnCatalogLabelKey(label.label_key)),
    [selectedRows],
  );
  const benchmarkRows = useMemo(
    () =>
      buildBenchmarkRows(
        labelSeries,
        selectedLabels,
        benchmarkMode,
        competitorLabels.map((label) => label.label_key),
      ).slice(-60),
    [benchmarkMode, competitorLabels, labelSeries, selectedLabels],
  );
  const shareRows = useMemo(
    () => buildShareRows(labelSeries, competitorLabels.map((label) => label.label_key), 60),
    [competitorLabels, labelSeries],
  );

  const referenceValue = benchmarkMode === "indexed" ? 100 : benchmarkMode === "median_growth" ? 0 : null;
  const yTick = (value: number) => {
    if (benchmarkMode === "absolute") return formatKmbTick(value);
    if (benchmarkMode === "per_track") return formatKmbTick(value);
    return `${Math.round(value)}${benchmarkMode === "median_growth" ? "pp" : ""}`;
  };

  return (
    <div className="space-y-4">
      <section className="sb-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Own catalog benchmark</h2>
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>
              {benchmarkMode === "median_growth"
                ? "Daily growth gap from the selected competitor median; zero means in line with peers."
                : "Each series uses the mean of its first seven positive days as the index baseline."}
            </p>
          </div>
          <div className="max-w-full overflow-x-auto pb-1">
            <ChipGroup segmented aria-label="Benchmark mode">
              {(Object.keys(MODE_LABEL) as BenchmarkMode[]).map((mode) => (
                <Chip key={mode} segmented selected={benchmarkMode === mode} onClick={() => setBenchmarkMode(mode)}>
                  {MODE_LABEL[mode]}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        </div>

        <div className="mt-3 h-80 min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 960, height: 320 }}
          >
            <LineChart data={benchmarkRows} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" minTickGap={28} tick={{ fill: colors.muted, fontSize: 10 }} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis tick={{ fill: colors.muted, fontSize: 10 }} tickFormatter={yTick} width={52} />
              {referenceValue != null ? <ReferenceLine y={referenceValue} stroke={colors.muted} strokeDasharray="4 4" /> : null}
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => {
                  const label = name === "__median" ? "Competitor median" : selectedRows.find((row) => row.label_key === name)?.display_name ?? name;
                  return [formatBenchmarkValue(Number(value ?? 0), benchmarkMode), label];
                }}
              />
              {selectedRows.map((label, index) => (
                <Line
                  key={label.label_key}
                  type="monotone"
                  dataKey={label.label_key}
                  name={label.label_key}
                  stroke={labelColor(label, index)}
                  strokeWidth={isOwnCatalogLabelKey(label.label_key) ? 3 : 1.8}
                  strokeDasharray={isOwnCatalogLabelKey(label.label_key) ? undefined : ""}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {selectedRows.map((label, index) => (
            <span key={label.label_key} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: colors.muted }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: labelColor(label, index) }} />
              {label.display_name}
            </span>
          ))}
        </div>
      </section>

      <section className="sb-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Tracked stream share</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            Share of selected competitor-label daily streams. Tracks present under multiple labels count in each label.
          </p>
        </div>
        <div className="mt-3 h-72 min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 960, height: 288 }}
          >
            <AreaChart data={shareRows} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" minTickGap={30} tick={{ fill: colors.muted, fontSize: 10 }} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: colors.muted, fontSize: 10 }} tickFormatter={(value) => `${Math.round(value)}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [
                  `${Number(value ?? 0).toFixed(1)}%`,
                  competitorLabels.find((label) => label.label_key === name)?.display_name ?? name,
                ]}
              />
              {competitorLabels.map((label, index) => (
                <Area
                  key={label.label_key}
                  type="monotone"
                  dataKey={label.label_key}
                  name={label.label_key}
                  stackId="share"
                  stroke={labelColor(label, index)}
                  fill={labelColor(label, index)}
                  fillOpacity={0.58}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
