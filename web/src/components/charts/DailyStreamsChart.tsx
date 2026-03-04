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
  computeWeekendDipMap,
  filterDailySeriesFromIsoDate,
  getSundayAccentColor,
  isHighlightDayDateUtc,
  formatKmbTick,
  formatUsdCompact,
  formatXAxisTick,
} from "@/components/charts/chartUtils";
import { useChartCopyToClipboard } from "@/components/charts/useChartCopyToClipboard";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { useWeekHighlight } from "@/components/charts/WeekHighlightContext";
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
import { useChartAxisZoom } from "@/components/charts/ChartAxisZoomContext";
import { useWeekendDip } from "@/components/charts/WeekendDipContext";
import { DailySeriesTooltip } from "@/components/charts/DailySeriesTooltip";
import { makeHighlightDayDotRenderers } from "@/components/charts/rechartsRenderers";

type DataPoint = {
  date: string;
  value: number | null;
  ma7?: number | null;
  _isPartial?: boolean;
  _bucketDays?: number;
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
  const { showWeekendDip } = useWeekendDip();

  // Weekend dip applies to daily (non-cumulative) charts, except Tracks
  const enableWeekendDip = showWeekendDip && !isCumulative && valueLabel !== "Tracks";

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
  // Compute weekend dip % when enabled (daily charts, not Tracks)
  const weekendDipMap = enableWeekendDip ? computeWeekendDipMap(filteredData) : null;

  const chartData = [...filteredData].reverse().map((d) => ({
    ...d,
    _overrideItems: (annItemsByDate.get(d.date) ?? null)?.map((a) => ({
      note: a.note,
      title: a.title,
      imageUrl: a.imageUrl ?? null,
    })) ?? null,
    _weekendDipPct: weekendDipMap?.get(d.date) ?? null,
  }));
  const hasMA7 = showMA7 && chartData.some((d) => d.ma7 !== null && d.ma7 !== undefined);
  const chartDates = new Set(chartData.map((d) => d.date));
  const annotationDates = [...annItemsByDate.keys()].filter((d) => chartDates.has(d));
  const highlightDates = chartData.filter((d) => isHighlightDayDateUtc(d.date, weekHighlightDayUtc)).map((d) => d.date);
  const partialDate = chartData.length > 0 && chartData[chartData.length - 1]._isPartial
    ? chartData[chartData.length - 1].date
    : null;

  // Calculate Y-axis domain:
  // - Cumulative: exact min/max (fills chart, avoids wasted space).
  // - Daily: "zoomed" domain around min/max with padding (improves at-a-glance deltas).
  // - Daily with negatives: always compute domain so negatives are visible (never clamped at 0).
  const v = chartData.map((d) => d.value);
  const ma = hasMA7 ? chartData.map((d) => d.ma7) : [];
  const hasNegatives = !isCumulative && [...v, ...ma].some(
    (x) => typeof x === "number" && Number.isFinite(x) && (x as number) < 0,
  );

  const yAxisDomain = (() => {
    if (chartData.length === 0) return undefined;
    if (isCumulative) {
      const values = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      if (!values.length) return undefined;
      return [Math.min(...values), Math.max(...values)] as [number, number];
    }
    if (!zoomDailyYAxis && !hasNegatives) return undefined;
    return computePaddedDomain([...v, ...ma], { clampMinToZero: false, padRatio: 0.10, minAbsPad: 1 });
  })();

  const finiteValues = [...v, ...ma].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const dataMax = finiteValues.length ? Math.max(...finiteValues) : 0;
  const dataMin = finiteValues.length ? Math.min(...finiteValues) : 0;
  const strokeZeroOffset = hasNegatives && dataMax > 0 && dataMin < 0
    ? `${(dataMax / (dataMax - dataMin) * 100).toFixed(2)}%`
    : null;
  // Fill BB spans [dataMax → dataMin] — same as the stroke path.
  const fillZeroOffset = strokeZeroOffset;

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  const ChartComponent = hasMA7 ? ComposedChart : AreaChart;
  const { dot: baseDot, activeDot: baseActiveDot } = makeHighlightDayDotRenderers({
    baseColor: effectiveColor,
    highlightColor: sundayColor,
    highlightWeekdayUtc: weekHighlightDayUtc,
    showWeekendDipLabels: enableWeekendDip,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.value;
    if (typeof val === "number" && val < 0) {
      const x = Number(props?.cx), y = Number(props?.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <circle cx={x} cy={y} r={3} fill="#ef4444" stroke="var(--sb-bg)" strokeWidth={1.5} />;
    }
    return baseDot(props);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeDot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.value;
    if (typeof val === "number" && val < 0) {
      const x = Number(props?.cx), y = Number(props?.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <circle cx={x} cy={y} r={4} fill="#ef4444" stroke="var(--sb-bg)" strokeWidth={1.5} />;
    }
    return baseActiveDot(props);
  };

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
              {fillZeroOffset ? (
                <>
                  <stop offset="0%" stopColor={effectiveColor} stopOpacity={0.3} />
                  <stop offset={fillZeroOffset} stopColor={effectiveColor} stopOpacity={0.05} />
                  <stop offset={fillZeroOffset} stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                </>
              ) : (
                <>
                  <stop offset="5%" stopColor={effectiveColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={effectiveColor} stopOpacity={0} />
                </>
              )}
            </linearGradient>
            {strokeZeroOffset && (
              <linearGradient id={`${gid}-stroke`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={effectiveColor} stopOpacity={1} />
                <stop offset={strokeZeroOffset} stopColor={effectiveColor} stopOpacity={1} />
                <stop offset={strokeZeroOffset} stopColor="#ef4444" stopOpacity={1} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={1} />
              </linearGradient>
            )}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--sb-border)"
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxisTick}
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
                isCumulative={isCumulative}
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
          {partialDate && (
            <ReferenceLine
              x={partialDate}
              stroke="var(--sb-muted)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              ifOverflow="hidden"
              label={{
                value: "partial",
                position: "insideTopRight",
                fontSize: 9,
                fill: "var(--sb-muted)",
                opacity: 0.7,
              }}
            />
          )}
          {hasNegatives && (
            <ReferenceLine
              y={0}
              stroke="#ef4444"
              strokeOpacity={0.45}
              strokeWidth={1}
              strokeDasharray="3 3"
              ifOverflow="hidden"
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeZeroOffset ? `url(#${gid}-stroke)` : effectiveColor}
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
