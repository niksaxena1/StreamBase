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

  const yAxisDomain = zoomDailyYAxis
    ? computePaddedDomain(
        [
          ...chartData.map((d) => d.daily),
          ...chartData.map((d) => d.ma7),
        ],
        { clampMinToZero: false, padRatio: 0.10, minAbsPad: 1 },
      )
    : undefined;

  const { dot, activeDot } = makeHighlightDayDotRenderers({
    baseColor: effectiveDailyColor,
    highlightColor: sundayColor,
    highlightWeekdayUtc: weekHighlightDayUtc,
    showWeekendDipLabels: enableWeekendDip,
  });

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
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={effectiveDailyColor} stopOpacity={0.28} />
              <stop offset="95%" stopColor={effectiveDailyColor} stopOpacity={0} />
            </linearGradient>
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
          <Area
            type="monotone"
            dataKey="daily"
            stroke={effectiveDailyColor}
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
