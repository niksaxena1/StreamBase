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
import { useId } from "react";

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
  daily: number | null;
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

export function DailyStreamsWithMAChart({
  data,
  valueLabel = "Streams",
  valueFormat = "int",
  yTickFormat = "k",
  dailyColor,
  maColor,
  heightPx = 220,
  annotations,
}: {
  data: DataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  dailyColor?: string;
  maColor?: string;
  heightPx?: number;
  annotations?: ManualOverrideAnnotation[];
}) {
  const gid = useId();
  const themeColors = useThemeColors();
  const { containerProps, setTooltipValues, copyModal } = useChartCopyToClipboard({ valueLabel });
  const { weekHighlightDayUtc } = useWeekHighlight();
  const { chartStartDateIso } = useChartStartDate();
  const { zoomDailyYAxis } = useChartAxisZoom();
  const { showWeekendDip } = useWeekendDip();

  // Weekend dip: always a daily chart, skip for Tracks metric
  const enableWeekendDip = showWeekendDip && valueLabel !== "Tracks";

  // Use theme-aware colors from CSS variables
  const effectiveDailyColor = dailyColor ?? themeColors.accentStroke;
  const effectiveMaColor = maColor ?? (themeColors.isDark ? "#ffffff" : "#000000");
  const sundayColor = getSundayAccentColor(effectiveDailyColor, { isDark: themeColors.isDark, bgColor: themeColors.bg });
  
  // Keep parity with DailyStreamsChart: accept newest-first and render oldest->newest
  const annItemsByDate = new Map<string, ManualOverrideAnnotation[]>();
  for (const a of annotations ?? []) {
    if (!a?.date) continue;
    const arr = annItemsByDate.get(a.date) ?? [];
    arr.push(a);
    annItemsByDate.set(a.date, arr);
  }

  const filteredData = filterDailySeriesFromIsoDate(data ?? [], chartStartDateIso);

  // Compute weekend dip % when enabled
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
  const chartDates = new Set(chartData.map((d) => d.date));
  const annotationDates = [...annItemsByDate.keys()].filter((d) => chartDates.has(d));
  const highlightDates = chartData.filter((d) => isHighlightDayDateUtc(d.date, weekHighlightDayUtc)).map((d) => d.date);
  const partialDate = chartData.length > 0 && chartData[chartData.length - 1]._isPartial
    ? chartData[chartData.length - 1].date
    : null;
  
  const hasMa7Data = chartData.some((d) => d.ma7 != null && !isNaN(Number(d.ma7)));

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  const allDailyValues = [
    ...chartData.map((d) => d.daily),
    ...chartData.map((d) => d.ma7),
  ];
  const hasNegatives = allDailyValues.some(
    (x) => typeof x === "number" && Number.isFinite(x) && (x as number) < 0,
  );

  const yAxisDomain = (zoomDailyYAxis || hasNegatives)
    ? computePaddedDomain(allDailyValues, { clampMinToZero: false, padRatio: 0.10, minAbsPad: 1 })
    : undefined;

  // Gradient split offsets for stroke/fill when negatives exist.
  // Stroke BB spans actual data extremes; fill BB spans from spline-max to chart baseline.
  // The fill uses yAxisDomain bounds (which include padding above any spline overshoot)
  // so the red-to-green transition lands at or just below zero, never above.
  const finiteValues = allDailyValues.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const dataMax = finiteValues.length ? Math.max(...finiteValues) : 0;
  const dataMin = finiteValues.length ? Math.min(...finiteValues) : 0;
  const strokeZeroOffset = hasNegatives && dataMax > 0 && dataMin < 0
    ? `${(dataMax / (dataMax - dataMin) * 100).toFixed(2)}%`
    : null;
  // Fill BB spans [dataMax → dataMin] (baseValue=0 means the fill polygon is bounded
  // by the data line on top and the zero-baseline on the bottom — same range as the stroke).
  // Using yAxisDomain[1] here over-estimates the BB top and pushes the transition below zero.
  const fillZeroOffset = strokeZeroOffset;

  const { dot: baseDot, activeDot: baseActiveDot } = makeHighlightDayDotRenderers({
    baseColor: effectiveDailyColor,
    highlightColor: sundayColor,
    highlightWeekdayUtc: weekHighlightDayUtc,
    showWeekendDipLabels: enableWeekendDip,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.daily;
    if (typeof val === "number" && val < 0) {
      const x = Number(props?.cx), y = Number(props?.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <circle cx={x} cy={y} r={3} fill="#ef4444" stroke="var(--sb-bg)" strokeWidth={1.5} />;
    }
    return baseDot(props);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeDot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.daily;
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
        <ComposedChart
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          style={{ outline: "none" }}
        >
          <defs>
            {/* Area fill gradient: accent above zero, red below zero */}
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              {fillZeroOffset ? (
                <>
                  <stop offset="0%" stopColor={effectiveDailyColor} stopOpacity={0.28} />
                  <stop offset={fillZeroOffset} stopColor={effectiveDailyColor} stopOpacity={0.05} />
                  <stop offset={fillZeroOffset} stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                </>
              ) : (
                <>
                  <stop offset="5%" stopColor={effectiveDailyColor} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={effectiveDailyColor} stopOpacity={0} />
                </>
              )}
            </linearGradient>
            {/* Stroke gradient: accent above zero, red below zero */}
            {strokeZeroOffset && (
              <linearGradient id={`${gid}-stroke`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={effectiveDailyColor} stopOpacity={1} />
                <stop offset={strokeZeroOffset} stopColor={effectiveDailyColor} stopOpacity={1} />
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
                chartColor={effectiveDailyColor}
                onValuesFormatted={(v) => {
                  setTooltipValues(v);
                }}
              />
            )}
            cursor={{
              stroke: effectiveDailyColor,
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
              opacity: 0.8,
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
            dataKey="daily"
            stroke={strokeZeroOffset ? `url(#${gid}-stroke)` : effectiveDailyColor}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gid})`}
            dot={dot}
            activeDot={activeDot}
          />
          {hasMa7Data && (
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
        </ComposedChart>
      </ResponsiveContainer>
      {copyModal}
    </div>
  );
}
