"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Crown, Gauge, TrendingUp } from "lucide-react";

import { formatInt } from "@/lib/format";
import { getChartTooltipStyle, useThemeColors } from "@/components/charts/useThemeColors";

import { buildRankRows } from "./competitorWorkspaceAnalytics";
import type { LabelDailyPoint, LabelRow } from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

function latestAndAverage(points: LabelDailyPoint[], latestDate: string) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latestPoint = sorted.find((point) => point.date === latestDate);
  const latest = latestPoint?.daily_streams_net ?? null;
  const prior = sorted.filter((point) => point.date < latestDate).slice(-7).map((point) => point.daily_streams_net);
  const avg = prior.length ? prior.reduce((sum, value) => sum + value, 0) / prior.length : 0;
  return { latest, avg, deltaPct: latest != null && avg > 0 ? ((latest - avg) / avg) * 100 : null };
}

export function CompetitorOverviewCharts({
  labels,
  labelSeries,
}: {
  labels: LabelRow[];
  labelSeries: LabelDailyPoint[];
}) {
  const colors = useThemeColors();
  const tooltipStyle = getChartTooltipStyle(colors);
  const activeLabels = useMemo(() => labels.filter((label) => label.is_active !== false), [labels]);
  const labelKeys = useMemo(() => activeLabels.map((label) => label.label_key), [activeLabels]);
  const latestDate = useMemo(
    () => [...new Set(labelSeries.map((point) => point.date))].sort().at(-1) ?? "",
    [labelSeries],
  );
  const seriesByLabel = useMemo(() => {
    const output = new Map<string, LabelDailyPoint[]>();
    for (const point of labelSeries) {
      const rows = output.get(point.label_key) ?? [];
      rows.push(point);
      output.set(point.label_key, rows);
    }
    return output;
  }, [labelSeries]);
  const summaries = useMemo(
    () =>
      activeLabels.map((label, index) => ({
        label,
        color: labelColor(label, index),
        ...latestAndAverage(seriesByLabel.get(label.label_key) ?? [], latestDate),
      })),
    [activeLabels, latestDate, seriesByLabel],
  );
  const rankRows = useMemo(() => buildRankRows(labelSeries, labelKeys, 30), [labelKeys, labelSeries]);
  const reporting = summaries.filter((summary) => summary.latest != null);
  const leader = [...reporting].sort((a, b) => (b.latest ?? 0) - (a.latest ?? 0))[0];
  const fastest = [...reporting]
    .filter((summary) => summary.deltaPct != null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  const totalToday = reporting.reduce((sum, row) => sum + (row.latest ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3" style={{ borderColor: colors.border, background: colors.border }}>
        {[
          {
            icon: Crown,
            label: "Daily leader",
            value: leader?.label.display_name ?? "-",
            detail: leader ? formatInt(leader.latest ?? 0) : "-",
            color: leader?.color ?? colors.accent,
          },
          {
            icon: TrendingUp,
            label: "Strongest vs 7d",
            value: fastest?.label.display_name ?? "-",
            detail: fastest?.deltaPct != null ? `${fastest.deltaPct >= 0 ? "+" : ""}${fastest.deltaPct.toFixed(1)}%` : "-",
            color: fastest?.deltaPct != null && fastest.deltaPct < 0 ? colors.error : colors.positive,
          },
          {
            icon: Gauge,
            label: "Tracked daily total",
            value: formatInt(totalToday),
            detail: `${reporting.length}/${summaries.length} reporting`,
            color: colors.info,
          },
        ].map((item) => (
          <div key={item.label} className="flex min-h-20 items-center gap-3 bg-[var(--sb-card)] px-4 py-3">
            <item.icon className="h-4 w-4 shrink-0" style={{ color: item.color }} />
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.muted }}>
                {item.label}
              </div>
              <div className="mt-1 truncate text-sm font-semibold" style={{ color: colors.text }}>
                {item.value}
              </div>
              <div className="font-mono text-[10px] tabular-nums" style={{ color: item.color }}>
                {item.detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="sb-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Daily pulse</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            One scale per universe keeps local direction readable; values remain absolute.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => {
            const rows = (seriesByLabel.get(summary.label.label_key) ?? []).slice(-30);
            return (
              <div
                key={summary.label.label_key}
                className="min-w-0 border-l-2 py-2 pl-3 pr-2"
                style={{ borderColor: summary.color }}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <div className="truncate text-xs font-semibold">{summary.label.display_name}</div>
                  <div className="shrink-0 font-mono text-[10px] tabular-nums" style={{ color: summary.color }}>
                    {summary.latest == null ? "No latest row" : formatInt(summary.latest)}
                  </div>
                </div>
                <div className="h-24 min-w-0">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    initialDimension={{ width: 320, height: 96 }}
                  >
                    <LineChart data={rows} margin={{ top: 5, right: 3, bottom: 2, left: 3 }}>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: colors.text, fontSize: 11 }}
                        formatter={(value) => [formatInt(Number(value ?? 0)), "Daily streams"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="daily_streams_net"
                        stroke={summary.color}
                        strokeWidth={1.8}
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-[10px]" style={{ color: colors.muted }}>
                  <span>{rows[0]?.date.slice(5) ?? ""}</span>
                  <span style={{ color: summary.deltaPct == null ? colors.muted : summary.deltaPct >= 0 ? colors.positive : colors.error }}>
                    {summary.deltaPct == null ? "No comparison" : `${summary.deltaPct >= 0 ? "+" : ""}${summary.deltaPct.toFixed(1)}% vs 7d`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="sb-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Daily rank</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            Rank 1 is the highest daily-stream total on each date.
          </p>
        </div>
        <div className="h-72 min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 960, height: 288 }}
          >
            <LineChart data={rankRows} margin={{ top: 10, right: 18, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: colors.muted, fontSize: 10 }} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis
                reversed
                domain={[1, Math.max(1, activeLabels.length)]}
                ticks={activeLabels.map((_, index) => index + 1)}
                allowDecimals={false}
                tick={{ fill: colors.muted, fontSize: 10 }}
                tickFormatter={(value) => `#${value}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [`#${Number(value)}`, activeLabels.find((label) => label.label_key === name)?.display_name ?? name]}
              />
              {activeLabels.map((label, index) => (
                <Line
                  key={label.label_key}
                  type="monotone"
                  dataKey={label.label_key}
                  name={label.label_key}
                  stroke={labelColor(label, index)}
                  strokeWidth={2}
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
          {activeLabels.map((label, index) => (
            <span key={label.label_key} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: colors.muted }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: labelColor(label, index) }} />
              {label.display_name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
