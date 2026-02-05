"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useId, useMemo } from "react";
import { formatInt, formatUsd2 } from "@/lib/format";
import { formatKmbTick, formatUsdCompact, getSundayAccentColor, isHighlightDayDateUtc } from "@/components/charts/chartUtils";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { useWeekHighlight } from "@/components/charts/WeekHighlightContext";

export const COLLECTOR_COLORS: Record<string, string> = {
  // Individuals (softer)
  A: "#BFDBFE", // blue-200
  K: "#FED7AA", // orange-200
  N: "#FECDD3", // rose-200

  // Corresponding LLCs (same hue family, more saturated)
  PL: "#2563EB", // blue-600
  TG: "#EA580C", // orange-600
  NL: "#E11D48", // rose-600
};

export type ComparisonMode = "combined" | "individual" | "percentage";
export type ComparisonMetric = "revenue" | "streams" | "tracks";

export type CollectorDailyData = {
  date: string;
  collector: string;
  daily_streams_net: number;
  est_revenue_daily_net: number;
  track_count: number;
  prev_track_count?: number; // For calculating daily track change
};

type ChartDataPoint = {
  date: string;
  [key: string]: number | string; // collector names or "combined" as keys
};

function formatTooltipDate(dateString: string, granularity: Granularity = "daily"): string {
  // For non-daily granularities, the dateString is a bucket key, not a date
  if (granularity === "weekly") {
    // Format: "2024-W01" -> "Week 1, 2024"
    const match = dateString.match(/(\d{4})-W(\d{2})/);
    if (match) return `Week ${parseInt(match[2], 10)}, ${match[1]}`;
    return dateString;
  }
  if (granularity === "monthly") {
    // Format: "2024-01" -> "January 2024"
    const [year, month] = dateString.split("-");
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  }
  if (granularity === "quarterly") {
    // Format: "Q1 2024" -> "Q1 2024"
    return dateString;
  }
  if (granularity === "yearly") {
    // Format: "2024" -> "2024"
    return dateString;
  }

  // Daily: full date format
  const date = new Date(dateString);
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();

  const getOrdinalSuffix = (n: number): string => {
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return "st";
    if (j === 2 && k !== 12) return "nd";
    if (j === 3 && k !== 13) return "rd";
    return "th";
  };

  return `${dayOfWeek}, ${day}${getOrdinalSuffix(day)} ${month} ${year}`;
}

function CustomTooltip({
  active,
  label,
  payload,
  mode,
  metric,
  granularity = "daily",
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number; dataKey: string; color: string }>;
  mode: ComparisonMode;
  metric: ComparisonMetric;
  granularity?: Granularity;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const formatValue = (n: number) => {
    if (mode === "percentage") return `${n.toFixed(1)}%`;
    if (metric === "revenue") return formatUsd2(n);
    return formatInt(n);
  };

  return (
    <ViewportAwareTooltip>
      <div
        className="rounded-lg border p-3"
        style={{
          backgroundColor: "var(--sb-card)",
          borderColor: "var(--sb-border)",
          boxShadow: "var(--sb-shadow-compact)",
          color: "var(--sb-text)",
        }}
      >
        {label && (
          <div className="mb-2 text-xs font-medium">{formatTooltipDate(label, granularity)}</div>
        )}
        {payload.map((entry, index) => {
          const collectorName = entry.dataKey === "combined" ? "Combined Total" : entry.dataKey;
          const color = entry.color || COLLECTOR_COLORS[entry.dataKey] || "#888";

          return (
            <div key={index} className="text-xs flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span style={{ color: "var(--sb-text)" }}>
                {collectorName}:{" "}
                <span className="font-bold" style={{ color }}>
                  {formatValue(Number(entry.value ?? 0))}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </ViewportAwareTooltip>
  );
}

export type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export function CollectorComparisonChart({
  data,
  selectedCollectors,
  mode,
  metric,
  heightPx = 300,
  granularity = "daily",
}: {
  data: CollectorDailyData[];
  selectedCollectors: string[];
  mode: ComparisonMode;
  metric: ComparisonMetric;
  heightPx?: number;
  granularity?: Granularity;
}) {
  const gid = useId();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const themeColors = useThemeColors();
  const { weekHighlightDayUtc } = useWeekHighlight();

  // Process data into chart format
  const chartData = useMemo(() => {
    if (!data.length || !selectedCollectors.length) return [];

    // Group data by date
    const byDate = new Map<string, Map<string, CollectorDailyData>>();
    
    // Sort data by date ascending first to calculate track deltas
    const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date));
    
    // Track previous track counts per collector for delta calculation (only needed for daily)
    const prevTrackCounts = new Map<string, number>();
    
    for (const row of sortedData) {
      if (!selectedCollectors.includes(row.collector)) continue;
      
      if (!byDate.has(row.date)) {
        byDate.set(row.date, new Map());
      }
      
      // Calculate track delta (only for daily granularity)
      let prevCount = row.track_count;
      if (granularity === "daily") {
        prevCount = prevTrackCounts.get(row.collector) ?? row.track_count;
        prevTrackCounts.set(row.collector, row.track_count);
      }
      
      byDate.get(row.date)!.set(row.collector, {
        ...row,
        prev_track_count: prevCount,
      });
    }

    // Convert to chart data points
    const dates = Array.from(byDate.keys()).sort();
    const result: ChartDataPoint[] = [];

    for (const date of dates) {
      const collectors = byDate.get(date)!;
      const point: ChartDataPoint = { date };

      // Get raw values for each selected collector
      const values: Record<string, number> = {};
      let total = 0;

      for (const collector of selectedCollectors) {
        const collectorData = collectors.get(collector);
        let value = 0;

        if (collectorData) {
          if (metric === "revenue") {
            value = Number(collectorData.daily_streams_net ?? 0) * streamPayoutPerStreamUsd;
          } else if (metric === "streams") {
            value = Number(collectorData.daily_streams_net ?? 0);
          } else if (metric === "tracks") {
            if (granularity === "daily") {
              // Daily track change - calculate delta
              const prev = collectorData.prev_track_count ?? collectorData.track_count;
              value = collectorData.track_count - prev;
            } else {
              // For aggregated data, track_count already contains the net change
              value = Number(collectorData.track_count ?? 0);
            }
          }
        }

        values[collector] = value;
        total += value;
      }

      if (mode === "combined") {
        point["combined"] = total;
      } else if (mode === "individual") {
        for (const collector of selectedCollectors) {
          point[collector] = values[collector];
        }
      } else if (mode === "percentage") {
        for (const collector of selectedCollectors) {
          // If total is 0, show 0% for all
          point[collector] = total === 0 ? 0 : (values[collector] / total) * 100;
        }
      }

      result.push(point);
    }

    return result;
  }, [data, selectedCollectors, mode, metric, granularity, streamPayoutPerStreamUsd]);

  const formatYTick = (n: number) => {
    if (mode === "percentage") return `${n.toFixed(0)}%`;
    if (metric === "revenue") return formatUsdCompact(n, formatUsd2);
    return formatKmbTick(n);
  };

  const yDomain = mode === "percentage" ? [0, 100] : undefined;
  const yTicks = mode === "percentage" ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] : undefined;

  // Determine which lines to render
  const lineKeys = mode === "combined" ? ["combined"] : selectedCollectors;
  const combinedColor = themeColors.accentStroke;

  const getLineColor = (key: string) => {
    if (key === "combined") return combinedColor;
    return COLLECTOR_COLORS[key] || "var(--sb-muted)";
  };

  // Match the Home hero chart vibe: a single subtle area fill when there's a single series.
  const areaKey =
    mode !== "percentage" && (mode === "combined" || selectedCollectors.length === 1)
      ? mode === "combined"
        ? "combined"
        : selectedCollectors[0]
      : null;

  const highlightDates = useMemo(() => {
    if (granularity !== "daily") return [];
    return chartData
      .filter((d) => isHighlightDayDateUtc(String(d.date ?? ""), weekHighlightDayUtc))
      .map((d) => String(d.date));
  }, [chartData, granularity, weekHighlightDayUtc]);

  const sundayBandColor = getSundayAccentColor(
    areaKey ? getLineColor(areaKey) : themeColors.accentStroke,
    { isDark: themeColors.isDark, bgColor: themeColors.bg },
  );

  if (!chartData.length) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height: heightPx, color: "var(--sb-muted)" }}
      >
        Select at least one collector to view the chart
      </div>
    );
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <ComposedChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs>
            {areaKey ? (
              <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getLineColor(areaKey)} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getLineColor(areaKey)} stopOpacity={0} />
              </linearGradient>
            ) : null}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sb-border)" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => {
              // For non-daily granularities, the "date" is already a formatted bucket key
              if (granularity === "weekly") {
                // Format: "2024-W01" -> "W01"
                return value.split("-")[1] || value;
              }
              if (granularity === "monthly") {
                // Format: "2024-01" -> "Jan '24"
                const [year, month] = value.split("-");
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return `${monthNames[parseInt(month, 10) - 1]} '${year.slice(2)}`;
              }
              if (granularity === "quarterly") {
                // Format: "Q1 2024" -> "Q1 '24"
                const match = value.match(/Q(\d) (\d{4})/);
                if (match) return `Q${match[1]} '${match[2].slice(2)}`;
                return value;
              }
              if (granularity === "yearly") {
                // Format: "2024" -> "2024"
                return value;
              }
              // Daily: format as dd/mm
              const date = new Date(value);
              const day = String(date.getDate()).padStart(2, "0");
              const month = String(date.getMonth() + 1).padStart(2, "0");
              return `${day}/${month}`;
            }}
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <YAxis
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatYTick}
            domain={yDomain}
            ticks={yTicks}
          />
          {mode === "percentage" ? (
            <ReferenceLine
              y={50}
              stroke="var(--sb-border)"
              strokeWidth={1.5}
              strokeDasharray="0"
              ifOverflow="extendDomain"
            />
          ) : null}
          <Tooltip
            content={({ active, label, payload }) => (
              <CustomTooltip
                active={active}
                label={label as string}
                payload={payload as Array<{ name: string; value: number; dataKey: string; color: string }>}
                mode={mode}
                metric={metric}
                granularity={granularity}
              />
            )}
            cursor={{
              stroke: areaKey ? getLineColor(areaKey) : "var(--sb-accent)",
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
              opacity: 0.8,
            }}
          />

          {/* Subtle highlight-day indicator (daily only) */}
          {granularity === "daily"
            ? highlightDates.map((d) => (
                <ReferenceLine
                  key={`highlight-${d}`}
                  x={d}
                  stroke={sundayBandColor}
                  strokeOpacity={themeColors.isDark ? 0.10 : 0.07}
                  strokeWidth={10}
                  strokeDasharray="0"
                  ifOverflow="hidden"
                />
              ))
            : null}

          {areaKey ? (
            <Area
              type="monotone"
              dataKey={areaKey}
              stroke={getLineColor(areaKey)}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gid}-area)`}
              dot={(props: any) => {
                const { cx, cy, payload } = props ?? {};
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                const base = getLineColor(areaKey);
                const sunday = getSundayAccentColor(base, { isDark: themeColors.isDark, bgColor: themeColors.bg });
                const date = String(payload?.date ?? "");
                const isHighlight = granularity === "daily" && date ? isHighlightDayDateUtc(date, weekHighlightDayUtc) : false;
                const fill = isHighlight ? sunday : base;
                const fillOpacity = isHighlight ? 0.78 : 1;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke="var(--sb-bg)"
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={(props: any) => {
                const { cx, cy, payload } = props ?? {};
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                const base = getLineColor(areaKey);
                const sunday = getSundayAccentColor(base, { isDark: themeColors.isDark, bgColor: themeColors.bg });
                const date = String(payload?.date ?? "");
                const isHighlight = granularity === "daily" && date ? isHighlightDayDateUtc(date, weekHighlightDayUtc) : false;
                const fill = isHighlight ? sunday : base;
                const fillOpacity = isHighlight ? 0.85 : 1;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    stroke="var(--sb-bg)"
                    strokeWidth={1.5}
                  />
                );
              }}
              isAnimationActive={true}
            />
          ) : null}

          {lineKeys.map((key) => {
            // If the area is being drawn for this key, skip the separate line to avoid double-stroking.
            if (areaKey && key === areaKey) return null;

            const color = getLineColor(key);
            const sunday = getSundayAccentColor(color, { isDark: themeColors.isDark, bgColor: themeColors.bg });
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                dot={(props: any) => {
                  const { cx, cy, payload } = props ?? {};
                  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                  const date = String(payload?.date ?? "");
                  const isHighlight = granularity === "daily" && date ? isHighlightDayDateUtc(date, weekHighlightDayUtc) : false;
                  const fill = isHighlight ? sunday : color;
                  const fillOpacity = isHighlight ? 0.78 : 1;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill={fill}
                      fillOpacity={fillOpacity}
                      stroke="var(--sb-bg)"
                      strokeWidth={1.5}
                    />
                  );
                }}
                activeDot={(props: any) => {
                  const { cx, cy, payload } = props ?? {};
                  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                  const date = String(payload?.date ?? "");
                  const isHighlight = granularity === "daily" && date ? isHighlightDayDateUtc(date, weekHighlightDayUtc) : false;
                  const fill = isHighlight ? sunday : color;
                  const fillOpacity = isHighlight ? 0.85 : 1;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={fill}
                      fillOpacity={fillOpacity}
                      stroke="var(--sb-bg)"
                      strokeWidth={1.5}
                    />
                  );
                }}
                isAnimationActive={true}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
