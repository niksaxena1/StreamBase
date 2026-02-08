"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { memo, useId } from "react";
import { formatInt, formatUsd } from "@/lib/format";
import {
  computePaddedDomain,
  filterDailySeriesFromIsoDate,
  getSundayAccentColor,
  isHighlightDayDateUtc,
  formatKmbTick,
  formatUsdCompact,
} from "@/components/charts/chartUtils";
import { useChartCopyToClipboard } from "@/components/charts/useChartCopyToClipboard";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { useWeekHighlight } from "@/components/charts/WeekHighlightContext";
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
import { useChartAxisZoom } from "@/components/charts/ChartAxisZoomContext";
import { DailySeriesTooltip } from "@/components/charts/DailySeriesTooltip";
import { makeHighlightDayDotRenderers } from "@/components/charts/rechartsRenderers";

type DataPoint = {
  date: string;
  value: number | null;
  ma7?: number | null;
};

type ManualOverrideAnnotation = {
  date: string;
  note: string;
  title?: string;
  imageUrl?: string | null;
};

type ValueFormat = "int" | "usd";
type YTickFormat = "k" | "int" | "usd_compact";

type TooltipPayload = {
  name: string;
  value: number | string;
  dataKey: string;
};

export const DailyStreamsChart = memo(function DailyStreamsChart({
  data,
  valueLabel = "Streams",
  valueFormat = "int",
  yTickFormat = "k",
  color,
  maColor,
  heightPx = 220,
  showMA7 = false,
  isCumulative = false,
  annotations,
}: {
  data: DataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  color?: string;
  maColor?: string;
  heightPx?: number;
  showMA7?: boolean;
  isCumulative?: boolean;
  annotations?: ManualOverrideAnnotation[];
}) {
  const gid = useId();
  const themeColors = useThemeColors();
  const { containerProps, setTooltipValues, copyModal } = useChartCopyToClipboard({ valueLabel });
  const { weekHighlightDayUtc } = useWeekHighlight();
  const { chartStartDateIso } = useChartStartDate();
  const { zoomDailyYAxis } = useChartAxisZoom();
  
  // Use theme-aware colors from CSS variables
  const effectiveColor = color ?? themeColors.accentStroke;
  const effectiveMaColor = maColor ?? (themeColors.isDark ? "#ffffff" : "#000000");
  const sundayColor = getSundayAccentColor(effectiveColor, { isDark: themeColors.isDark, bgColor: themeColors.bg });

  const annItemsByDate = new Map<string, ManualOverrideAnnotation[]>();
  for (const a of annotations ?? []) {
    if (!a?.date) continue;
    const arr = annItemsByDate.get(a.date) ?? [];
    arr.push(a);
    annItemsByDate.set(a.date, arr);
  }

  const filteredData = filterDailySeriesFromIsoDate(data ?? [], chartStartDateIso);

  // Reverse data if it's in descending order (newest first) -> charts usually need ascending
  const chartData = [...filteredData].reverse().map((d) => ({
    ...d,
    _overrideItems: (annItemsByDate.get(d.date) ?? null)?.map((a) => ({
      note: a.note,
      title: a.title,
      imageUrl: a.imageUrl ?? null,
    })) ?? null,
  }));
  const hasMA7 = showMA7 && chartData.some((d) => d.ma7 !== null && d.ma7 !== undefined);
  const chartDates = new Set(chartData.map((d) => d.date));
  const annotationDates = [...annItemsByDate.keys()].filter((d) => chartDates.has(d));
  const highlightDates = chartData.filter((d) => isHighlightDayDateUtc(d.date, weekHighlightDayUtc)).map((d) => d.date);

  // Calculate Y-axis domain:
  // - Cumulative: exact min/max (fills chart, avoids wasted space).
  // - Daily: "zoomed" domain around min/max with padding (improves at-a-glance deltas).
  const yAxisDomain = (() => {
    if (chartData.length === 0) return undefined;
    const v = chartData.map((d) => d.value);
    const ma = hasMA7 ? chartData.map((d) => d.ma7) : [];
    if (isCumulative) {
      const values = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      if (!values.length) return undefined;
      return [Math.min(...values), Math.max(...values)] as [number, number];
    }
    if (!zoomDailyYAxis) return undefined;
    return computePaddedDomain([...v, ...ma], { clampMinToZero: false, padRatio: 0.10, minAbsPad: 1 });
  })();

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  const ChartComponent = hasMA7 ? ComposedChart : AreaChart;
  const { dot, activeDot } = makeHighlightDayDotRenderers({
    baseColor: effectiveColor,
    highlightColor: sundayColor,
    highlightWeekdayUtc: weekHighlightDayUtc,
  });

  return (
    <div
      className="w-full overflow-visible outline-none"
      {...containerProps}
    >
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0} style={{ overflow: "visible" }}>
        <ChartComponent
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          style={{ outline: "none" }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={effectiveColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={effectiveColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--sb-border)"
          />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => {
              const date = new Date(value);
              const day = String(date.getDate()).padStart(2, '0');
              const month = String(date.getMonth() + 1).padStart(2, '0');
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
            tickFormatter={(value) => fmtYTick(Number(value ?? 0))}
            domain={yAxisDomain}
          />
          <Tooltip
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 10000 }}
            content={({ active, label, payload }) => (
              <DailySeriesTooltip
                active={active}
                label={label as string}
                payload={payload as TooltipPayload[]}
                valueLabel={valueLabel}
                fmtValue={fmtValue}
                isDark={themeColors.isDark}
                chartColor={effectiveColor}
                onValuesFormatted={(v) => {
                  setTooltipValues(v);
                }}
              />
            )}
            cursor={{
              stroke: effectiveColor,
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
              opacity: 0.8
            }}
          />
          {/* Subtle highlight-day indicator (daily charts) */}
          {highlightDates.map((d) => (
            <ReferenceLine
              key={`highlight-${d}`}
              x={d}
              stroke={sundayColor}
              strokeOpacity={themeColors.isDark ? 0.10 : 0.07}
              strokeWidth={10}
              strokeDasharray="0"
              ifOverflow="hidden"
            />
          ))}
          {annotationDates.map((d) => (
            <ReferenceLine
              key={`override-${d}`}
              x={d}
              stroke={themeColors.warning}
              strokeOpacity={0.35}
              strokeWidth={2}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          ))}
          <Area
            type="monotone"
            dataKey="value"
            stroke={effectiveColor}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gid})`}
            dot={dot}
            activeDot={activeDot}
          />
          {hasMA7 && (
            <Line
              type="monotone"
              dataKey="ma7"
              stroke={effectiveMaColor}
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
              strokeDasharray="6 4"
              connectNulls={false}
              name="ma7"
            />
          )}
        </ChartComponent>
      </ResponsiveContainer>
      {copyModal}
    </div>
  );
});
