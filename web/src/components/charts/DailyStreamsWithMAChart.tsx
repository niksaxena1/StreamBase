"use client";

import {
  Area,
  getNiceTickValues,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useId, useMemo, type ReactElement } from "react";
import { clipDailySeries, typicalDailyDomain } from "./dailyRange";
import { CappedDailyPoint } from "./DailyRangeControls";
import { DailyChartLabels, UniformYAxisTick } from "./DailyChartLabels";
import { usePhoneChart } from "./usePhoneChart";
import { AdaptiveChartToolbar } from "./AdaptiveChartToolbar";
import { useAdaptiveChart } from "./useAdaptiveChart";
import { YOY_SERIES_KEY } from "./yoyCompare";
import type { ChartViewport } from "./useChartViewport";
import { TouchChartPoint, useTouchChartTooltip } from "./useTouchChartTooltip";

import { formatCompactMoney, formatInt, formatUsd } from "@/lib/format";
import {
  computePaddedDomain,
  computeWeekendDipMap,
  filterDailySeriesFromIsoDate,
  getSundayAccentColor,
  isHighlightDayDateUtc,
  formatKmbTick,
  readableLightChartColor,
  formatXAxisTick,
} from "@/components/charts/chartUtils";
import { useChartCopyToClipboard } from "@/components/charts/useChartCopyToClipboard";
import { getChartColor, useThemeColors } from "@/components/charts/useThemeColors";
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
  typicalRange = false,
  adaptiveView,
  firstLiveDateIso,
  onNeedMoreData,
  adaptiveRootLabel,
}: {
  data: DataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  dailyColor?: string;
  maColor?: string;
  heightPx?: number;
  annotations?: ManualOverrideAnnotation[];
  /** Opt in only for daily streams on Home, Playlists, and Catalog. */
  typicalRange?: boolean;
  /** Opt-in zoom / granularity / archived-boundary behaviour (see `useChartViewport`). */
  adaptiveView?: ChartViewport;
  firstLiveDateIso?: string | null;
  onNeedMoreData?: (dateIso: string) => boolean | void;
  adaptiveRootLabel?: string;
}) {
  const gid = useId();
  const typical = typicalRange;
  const themeColors = useThemeColors();
  const phone = usePhoneChart();
  const negativeColor = themeColors.isDark ? "#ef4444" : themeColors.error;
  const labelColor = themeColors.isDark ? "var(--sb-muted)" : "var(--sb-chart-label)";
  const { containerProps, setTooltipValues, copyModal } = useChartCopyToClipboard({ valueLabel });
  const { weekHighlightDayUtc } = useWeekHighlight();
  const { chartStartDateIso } = useChartStartDate();
  const { zoomDailyYAxis } = useChartAxisZoom();
  const { showWeekendDip } = useWeekendDip();
  const view = adaptiveView;
  const viewMode = view?.mode;
  const viewWindow = view?.window;
  const touchKey = useMemo(
    () => ({ data, typical, chartStartDateIso, viewMode, viewWindow }),
    [data, typical, chartStartDateIso, viewMode, viewWindow],
  );
  const { setContainer: touchContainerRef, pinned, touch, onPointerDownCapture, onPointerUpCapture, onPointerCancelCapture, onPointerMoveCapture } = useTouchChartTooltip(touchKey);

  const filteredData = useMemo(
    () => filterDailySeriesFromIsoDate(data ?? [], chartStartDateIso),
    [data, chartStartDateIso],
  );
  const adaptive = useAdaptiveChart({
    view,
    rows: filteredData,
    valueKey: "daily",
    isCumulative: false,
    firstLiveDateIso,
    phone,
    touch,
    onNeedMoreData,
  });

  // Weekend dip: always a daily chart, skip for Tracks metric. Adaptive views only keep it for short daily spans.
  const enableWeekendDip = showWeekendDip && valueLabel !== "Tracks" && adaptive.dailyDetail;

  // Use theme-aware colors from CSS variables
  const requestedColor = dailyColor ?? getChartColor("streams", themeColors);
  const effectiveDailyColor = themeColors.isDark ? requestedColor : readableLightChartColor(requestedColor, themeColors.bg);
  const requestedMaColor = maColor ?? (themeColors.isDark ? "#ffffff" : "var(--sb-chart-ma)");
  const effectiveMaColor = themeColors.isDark ? requestedMaColor : readableLightChartColor(requestedMaColor, themeColors.bg);
  const sundayColor = getSundayAccentColor(effectiveDailyColor, { isDark: themeColors.isDark, bgColor: themeColors.bg });
  
  // Keep parity with DailyStreamsChart: accept newest-first and render oldest->newest
  const annItemsByDate = new Map<string, ManualOverrideAnnotation[]>();
  for (const a of annotations ?? []) {
    if (!a?.date) continue;
    const arr = annItemsByDate.get(a.date) ?? [];
    arr.push(a);
    annItemsByDate.set(a.date, arr);
  }

  // Memoized: at 1,000+ points this chain must not rerun on unrelated state changes (drag selection, pinned tooltip).
  const { chartData, rawChartData, typicalDomain } = useMemo(() => {
    const sourceRows = adaptive.rowsDesc;
    // Compute weekend dip % when enabled
    const weekendDipMap = enableWeekendDip ? computeWeekendDipMap(sourceRows) : null;
    const raw = [...sourceRows].reverse().map((d) => ({
      ...d,
      _overrideItems: (annItemsByDate.get(d.date) ?? null)?.map((a) => ({
        note: a.note,
        title: a.title,
        imageUrl: a.imageUrl ?? null,
      })) ?? null,
      _weekendDipPct: weekendDipMap?.get(d.date) ?? null,
    }));
    const domain = typical ? typicalDailyDomain(raw.map((d) => d.daily)) : undefined;
    const dailyClips = domain ? clipDailySeries(raw.map((d) => d.daily), domain) : null;
    const maClips = domain ? clipDailySeries(raw.map((d) => d.ma7), domain) : null;
    const rows = raw.map((d, index) => ({
      ...d,
      _rangeValue: dailyClips ? dailyClips[index].value : d.daily,
      _rangeEdge: dailyClips?.[index].clipped ?? null,
      _rangeLabel: dailyClips?.[index].showLabel ?? false,
      _rangeMa7: maClips ? maClips[index].value : d.ma7,
      _rangeMaEdge: maClips?.[index].clipped ?? null,
      _rangeMaLabel: maClips?.[index].showLabel ?? false,
    }));
    return { chartData: rows, rawChartData: raw, typicalDomain: domain };
    // annItemsByDate is derived from `annotations` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adaptive.rowsDesc, annotations, enableWeekendDip, typical]);
  const hasMa7Data = rawChartData.some((d) => d.ma7 != null && !isNaN(Number(d.ma7)));
  // Zoomed out past the daily limit with an explicit "Daily": the 7-day average is the bold line, daily values faint dots.
  const faintDaily = adaptive.forcedDaily && hasMa7Data;
  const chartDates = new Set(chartData.map((d) => d.date));
  const annotationDates = [...annItemsByDate.keys()].filter((d) => chartDates.has(d));
  const highlightDates = adaptive.dailyDetail
    ? chartData.filter((d) => isHighlightDayDateUtc(d.date, weekHighlightDayUtc)).map((d) => d.date)
    : [];
  const partialDate = chartData.length > 0 && chartData[chartData.length - 1]._isPartial
    ? chartData[chartData.length - 1].date
    : null;
  


  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatCompactMoney(n, formatUsd);
    return formatKmbTick(n);
  };

  const allDailyValues = [
    ...chartData.map((d) => d.daily),
    ...chartData.map((d) => d.ma7),
    // The previous-year overlay shares the y axis, so it must be inside the domain.
    ...(adaptive.compareOn ? chartData.map((d) => (d as { _prevValue?: number | null })._prevValue) : []),
  ];
  const hasNegatives = allDailyValues.some(
    (x) => typeof x === "number" && Number.isFinite(x) && (x as number) < 0,
  );

  const yAxisDomain = typicalDomain ?? ((zoomDailyYAxis || hasNegatives)
    ? computePaddedDomain(allDailyValues, { clampMinToZero: false, padRatio: 0.10, minAbsPad: 1 })
    : undefined);

  // Gradient split offsets for stroke/fill when negatives exist.
  // Stroke BB spans actual data extremes; fill BB spans from spline-max to chart baseline.
  // The fill uses yAxisDomain bounds (which include padding above any spline overshoot)
  // so the red-to-green transition lands at or just below zero, never above.
  const finiteValues = (typical ? [...chartData.map((d) => d._rangeValue), ...chartData.map((d) => d._rangeMa7)] : allDailyValues).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const dataMax = finiteValues.length ? Math.max(...finiteValues) : 0;
  const dataMin = finiteValues.length ? Math.min(...finiteValues) : 0;
  // Match Recharts' default nice domain, then supply numeric bounds so label
  // placement and every tick use exactly the same scale.
  const fallbackTicks = yAxisDomain ? [] : getNiceTickValues([0, Math.max(1, dataMax)], 5);
  const resolvedYAxisDomain: [number, number] = yAxisDomain ?? [fallbackTicks[0], fallbackTicks[fallbackTicks.length - 1]];
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
    showWeekendDipLabels: false,
    enabled: adaptive.dailyDetail,
    isDark: themeColors.isDark,
  });

  // Hollow point = partial bucket (gaps, unfinished week/month); faint dot = daily value behind a bold 7-day line.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adaptiveDot = (props: any, radius: number): ReactElement | null => {
    const payload = props?.payload as Record<string, unknown> | undefined;
    const x = Number(props?.cx), y = Number(props?.cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (payload?._partialBucket && typeof payload.daily === "number") {
      return <circle cx={x} cy={y} r={radius + 0.5} fill="var(--sb-bg)" stroke={effectiveDailyColor} strokeWidth={2} strokeDasharray="2 2" />;
    }
    if (faintDaily && typeof payload?.daily === "number" && payload.daily >= 0) {
      return <circle cx={x} cy={y} r={radius - 1.5} fill={effectiveDailyColor} fillOpacity={0.35} />;
    }
    return null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.daily;
    const edge = props?.payload?._rangeEdge;
    if (adaptive.active) {
      const special = adaptiveDot(props, 3);
      if (special) return special;
    }
    if (typical && typeof val === "number" && (edge === "low" || edge === "high")) {
      return <CappedDailyPoint cx={Number(props.cx)} cy={Number(props.cy)} formattedValue={fmtYTick(val)} showLabel={false} edge={edge} color={val < 0 ? negativeColor : effectiveDailyColor} index={Number(props.index)} count={chartData.length} />;
    }
    if (typeof val === "number" && val < 0) {
      const x = Number(props?.cx), y = Number(props?.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <circle cx={x} cy={y} r={3} fill={negativeColor} stroke="var(--sb-bg)" strokeWidth={1.5} />;
    }
    return baseDot(props);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dot = (props: any) => <TouchChartPoint cx={Number(props.cx)} cy={Number(props.cy)} index={Number(props.index)}>{renderDot(props)}</TouchChartPoint>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeDot = (props: any) => {
    const val = (props?.payload as Record<string, unknown>)?.daily;
    const edge = props?.payload?._rangeEdge;
    if (adaptive.active && props?.payload?._partialBucket && typeof val === "number") {
      return adaptiveDot(props, 4.5);
    }
    if (typical && typeof val === "number" && (edge === "low" || edge === "high")) {
      return <CappedDailyPoint cx={Number(props.cx)} cy={Number(props.cy)} formattedValue={fmtYTick(val)} showLabel={false} edge={edge} color={val < 0 ? negativeColor : effectiveDailyColor} index={Number(props.index)} count={chartData.length} />;
    }
    if (typeof val === "number" && val < 0) {
      const x = Number(props?.cx), y = Number(props?.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <circle cx={x} cy={y} r={4} fill={negativeColor} stroke="var(--sb-bg)" strokeWidth={1.5} />;
    }
    return baseActiveDot(props);
  };

  const maDot = (props: { cx?: number; cy?: number; index?: number; payload?: { ma7?: number | null; _rangeMaEdge?: "low" | "high" | null; _rangeMaLabel?: boolean } }) => {
    const val = props.payload?.ma7;
    const edge = props.payload?._rangeMaEdge;
    if (typeof val !== "number") return <g />;
    return <TouchChartPoint cx={Number(props.cx)} cy={Number(props.cy)} index={Number(props.index)}>{!typical || !edge ? <circle cx={props.cx} cy={props.cy} r={3} fill="transparent" pointerEvents="none" /> : <CappedDailyPoint cx={Number(props.cx)} cy={Number(props.cy)} formattedValue={fmtYTick(val)} showLabel={false} edge={edge} color={effectiveMaColor} index={Number(props.index)} count={chartData.length} />}</TouchChartPoint>;
  };

  const pinnedPoint = pinned ? chartData[pinned.index] : undefined;

  return (
    <>
    {adaptive.active && view ? (
      <AdaptiveChartToolbar
        view={view}
        granularity={adaptive.granularity}
        forcedDaily={faintDaily}
        isCumulative={false}
        bounds={adaptive.bounds}
        phone={phone}
        rootLabel={adaptiveRootLabel}
        onNeedMoreData={onNeedMoreData}
        compareAvailable={adaptive.compareAvailable}
        compareOn={adaptive.compareOn}
        compareColor={effectiveDailyColor}
      />
    ) : null}
    <div
      className="relative w-full overflow-visible outline-none"
      ref={touchContainerRef}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={(event) => { containerProps.onPointerUp(); onPointerUpCapture(event); }}
      onPointerCancelCapture={() => { containerProps.onPointerCancel(); onPointerCancelCapture(); }}
      onPointerMoveCapture={onPointerMoveCapture}
      {...containerProps}
      onClick={adaptive.guardCopyClick(containerProps.onClick)}
    >
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0} style={{ overflow: "visible" }}>
        <ComposedChart
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          style={{ outline: "none" }}
          {...adaptive.chartHandlers}
        >
          <defs>
            {/* Area fill gradient: accent above zero, red below zero */}
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              {fillZeroOffset ? (
                <>
                  <stop offset="0%" stopColor={effectiveDailyColor} stopOpacity={0.28} />
                  <stop offset={fillZeroOffset} stopColor={effectiveDailyColor} stopOpacity={0.05} />
                  <stop offset={fillZeroOffset} stopColor={negativeColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={negativeColor} stopOpacity={0.4} />
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
                <stop offset={strokeZeroOffset} stopColor={negativeColor} stopOpacity={1} />
                <stop offset="100%" stopColor={negativeColor} stopOpacity={1} />
              </linearGradient>
            )}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke={themeColors.isDark ? "var(--sb-border)" : "var(--sb-chart-grid)"}
          />
          <XAxis
            dataKey="date"
            tickFormatter={adaptive.active ? adaptive.tickFormatter : formatXAxisTick}
            stroke={labelColor}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <YAxis
            stroke={labelColor}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tick={<UniformYAxisTick money={yTickFormat === "usd_compact"} isDark={themeColors.isDark} />}
            width={phone ? 40 : 60}
            domain={resolvedYAxisDomain}
            allowDataOverflow={typical}
          />
          <Tooltip
            active={touch ? false : undefined}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 10000 }}
            content={({ active, label, payload }) => (
              <DailySeriesTooltip
                active={active}
                label={label as string}
                payload={payload?.filter((entry) => entry.dataKey !== YOY_SERIES_KEY).map((entry) => entry.dataKey === "_rangeValue"
                    ? { ...entry, dataKey: "daily", value: entry.payload?.daily }
                    : entry.dataKey === "_rangeMa7" ? { ...entry, dataKey: "ma7", value: entry.payload?.ma7 } : entry) as TooltipPayload[]}
                valueLabel={valueLabel}
                fmtValue={fmtValue}
                isDark={themeColors.isDark}
                chartColor={effectiveDailyColor}
                formatDate={adaptive.active ? adaptive.formatDate : undefined}
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
          {/* Archived history (before the first live snapshot): subtle shading with a label */}
          {adaptive.active && adaptive.archiveShade ? (
            <ReferenceArea
              x1={adaptive.archiveShade.x1}
              x2={adaptive.archiveShade.x2}
              fill={themeColors.isDark ? "#ffffff" : "#000000"}
              fillOpacity={themeColors.isDark ? 0.045 : 0.05}
              stroke="none"
              ifOverflow="hidden"
              label={{ value: "Archived history", position: "insideTopLeft", fontSize: 10, fill: labelColor }}
            />
          ) : null}
          {adaptive.dragArea ? (
            <ReferenceArea
              x1={adaptive.dragArea.x1}
              x2={adaptive.dragArea.x2}
              fill={effectiveDailyColor}
              fillOpacity={0.15}
              stroke={effectiveDailyColor}
              strokeOpacity={0.45}
              ifOverflow="visible"
            />
          ) : null}
          {adaptive.gotoDate ? (
            <ReferenceLine
              x={adaptive.gotoDate}
              stroke={effectiveDailyColor}
              strokeWidth={2}
              strokeDasharray="2 3"
              ifOverflow="visible"
            />
          ) : null}
          {/* Subtle highlight-day indicator (daily charts) */}
          {highlightDates.map((d) => (
            <ReferenceLine
              key={`highlight-${d}`}
              x={d}
              stroke={themeColors.isDark ? sundayColor : "var(--sb-chart-weekend)"}
              strokeOpacity={themeColors.isDark ? 0.10 : 0.14}
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
              strokeOpacity={themeColors.isDark ? 0.35 : 1}
              strokeWidth={2}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          ))}
          {partialDate && (
            <ReferenceLine
              x={partialDate}
              stroke={labelColor}
              strokeOpacity={themeColors.isDark ? 0.5 : 1}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              ifOverflow="hidden"
            />
          )}
          {hasNegatives && (
            <ReferenceLine
              y={0}
              stroke={negativeColor}
              strokeOpacity={themeColors.isDark ? 0.45 : 1}
              strokeWidth={1}
              strokeDasharray="3 3"
              ifOverflow="hidden"
            />
          )}
          {adaptive.compareOn ? (
            <Line
              type="monotone"
              dataKey={YOY_SERIES_KEY}
              name="Previous year"
              stroke="var(--sb-muted)"
              strokeOpacity={0.85}
              strokeWidth={1.75}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey={typical ? "_rangeValue" : "daily"}
            name="daily"
            stroke={faintDaily ? "transparent" : strokeZeroOffset ? `url(#${gid}-stroke)` : effectiveDailyColor}
            strokeWidth={2}
            fillOpacity={faintDaily ? 0.5 : 1}
            fill={`url(#${gid})`}
            connectNulls={false}
            dot={dot}
            activeDot={activeDot}
          />
          {hasMa7Data && (
            <Line
              type="monotone"
              dataKey={typical ? "_rangeMa7" : "ma7"}
              stroke={faintDaily ? effectiveDailyColor : effectiveMaColor}
              strokeWidth={faintDaily ? 2.5 : 3}
              dot={maDot}
              activeDot={typical ? maDot : undefined}
              isAnimationActive={false}
              strokeDasharray={faintDaily ? undefined : "6 4"}
              connectNulls={false}
              name="ma7"
            />
          )}
          <DailyChartLabels phone={phone} showDips={enableWeekendDip} isDark={themeColors.isDark}
            points={chartData.map(d => ({ date: d.date, value: d._rangeValue, ma7: d._rangeMa7, dip: d._weekendDipPct,
              edge: d._rangeEdge, maEdge: d._rangeMaEdge, partial: d.date === partialDate,
              capColor: (d.daily ?? 0) < 0 ? negativeColor : effectiveDailyColor, maCapColor: effectiveMaColor,
              capLabel: typical && d._rangeLabel && d.daily != null ? fmtYTick(d.daily) : undefined,
              maCapLabel: typical && d._rangeMaLabel && d.ma7 != null ? fmtYTick(d.ma7) : undefined,
            }))} />
        </ComposedChart>
      </ResponsiveContainer>
      {pinnedPoint && pinned ? (
        <div data-sb-pinned-tooltip style={{ position: "absolute", left: pinned.x + 12,
          top: Math.max(0, Math.min(heightPx - 100, pinned.y)), zIndex: 10000 }}>
          <DailySeriesTooltip active label={pinnedPoint.date}
            payload={[
              ...(pinnedPoint.daily != null ? [{ dataKey: "daily", value: pinnedPoint.daily, payload: pinnedPoint }] : []),
              ...(pinnedPoint.ma7 != null ? [{ dataKey: "ma7", value: pinnedPoint.ma7, payload: pinnedPoint }] : []),
            ]}
            valueLabel={valueLabel} fmtValue={fmtValue} isDark={themeColors.isDark}
            chartColor={effectiveDailyColor} onValuesFormatted={setTooltipValues}
            formatDate={adaptive.active ? adaptive.formatDate : undefined}
            onZoomHere={adaptive.active && adaptive.granularity !== "daily" ? () => adaptive.drillInto(pinnedPoint.date) : undefined} />
        </div>
      ) : null}
      {copyModal}
    </div>
    </>
  );
}
