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
import { useEffect, useId, useRef } from "react";

import { formatInt, formatUsd } from "@/lib/format";
import {
  extractOverrideItemsFromRechartsPayload,
  formatTooltipDateDaily,
  getSundayAccentColor,
  isSundayDate,
  formatKmbTick,
  formatUsdCompact,
} from "@/components/charts/chartUtils";
import { useChartCopyToClipboard, type TooltipCopyValues } from "@/components/charts/useChartCopyToClipboard";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";

type DataPoint = {
  date: string;
  daily: number | null;
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

function CustomTooltip({
  active,
  label,
  payload,
  valueLabel,
  fmtValue,
  isDark,
  chartColor,
  onValuesFormatted,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayload[];
  valueLabel: string;
  fmtValue: (n: number) => string;
  isDark: boolean;
  chartColor: string;
  onValuesFormatted?: (v: TooltipCopyValues) => void;
}) {
  // Avoid update loops by only notifying when values change.
  const lastSentKeyRef = useRef<string>("");

  const safePayload = payload ?? [];
  const toNum = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Sort payload: daily first, then ma7
  const sorted = safePayload.length
    ? [...safePayload].sort((a, b) => {
    const aIsMA = a.dataKey === "ma7";
    const bIsMA = b.dataKey === "ma7";
    if (aIsMA && !bIsMA) return 1;
    if (!aIsMA && bIsMA) return -1;
    return 0;
    })
    : [];

  const mainValue = sorted[0];
  const mainValueNum = mainValue ? toNum(mainValue.value) : null;
  const mainValueFormatted = mainValueNum == null ? null : fmtValue(mainValueNum);
  const maEntry = sorted.find((e) => e.dataKey === "ma7");
  const ma7Num = maEntry ? toNum(maEntry.value) : null;
  const ma7ValueFormatted = ma7Num == null ? null : fmtValue(Math.round(ma7Num));
  const overrideItems = extractOverrideItemsFromRechartsPayload(safePayload);
  useEffect(() => {
    if (!active) return;
    if (!mainValueFormatted) return;
    const key = `${label ?? ""}||${mainValueFormatted}||${ma7ValueFormatted ?? ""}`;
    if (key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    onValuesFormatted?.({ label: label ?? null, main: mainValueFormatted, ma7: ma7ValueFormatted });
  }, [active, label, mainValueFormatted, ma7ValueFormatted, onValuesFormatted]);

  if (!active || sorted.length === 0) return null;

  return (
    <ViewportAwareTooltip>
      <div
        className="rounded-lg border p-3 max-h-[60vh] overflow-auto"
        style={{
          backgroundColor: "var(--sb-card)",
          borderColor: "var(--sb-border)",
          boxShadow: "var(--sb-shadow-compact)",
          color: "var(--sb-text)",
        }}
      >
        {label && (
          <div className="mb-2 text-xs font-medium">{formatTooltipDateDaily(label)}</div>
        )}
        {sorted.map((entry, index) => {
          const isMA = entry.dataKey === "ma7";
          const label = isMA ? "MA (7d)" : valueLabel;
          const raw = toNum(entry.value);
          let value = raw == null ? "—" : fmtValue(raw);
          
          // Round MA7 to nearest whole number
          if (isMA) {
            value = raw == null ? "—" : fmtValue(Math.round(raw));
          }

          const valueColor = isDark ? chartColor : "var(--sb-text)";

          return (
            <div key={index} className="text-xs">
              <span style={{ color: "var(--sb-text)" }}>
                {label}: <span className="font-bold" style={{ color: valueColor }}>{value}</span>
              </span>
            </div>
          );
        })}
        {overrideItems?.length ? (
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--sb-border)" }}>
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--sb-warning)" }}>
              Manual override
            </div>
            <div className="mt-1 space-y-1">
              {overrideItems.map((it, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt=""
                      className="h-8 w-8 rounded-md object-cover sb-ring"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
                  )}
                  <div className="min-w-0">
                    {it.title ? (
                      <div className="text-xs font-medium truncate" style={{ color: "var(--sb-text)" }}>
                        {it.title}
                      </div>
                    ) : null}
                    <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                      {it.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ViewportAwareTooltip>
  );
}

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

  const chartData = [...data].reverse().map((d) => ({
    ...d,
    _overrideItems: (annItemsByDate.get(d.date) ?? null)?.map((a) => ({
      note: a.note,
      title: a.title,
      imageUrl: a.imageUrl ?? null,
    })) ?? null,
  }));
  const chartDates = new Set(chartData.map((d) => d.date));
  const annotationDates = [...annItemsByDate.keys()].filter((d) => chartDates.has(d));
  const sundayDates = chartData.filter((d) => isSundayDate(d.date)).map((d) => d.date);
  
  // Debug: Check if we have any ma7 values
  const hasMa7Data = chartData.some((d) => d.ma7 != null && !isNaN(Number(d.ma7)));

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
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
          />
          <Tooltip
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 1000 }}
            content={({ active, label, payload }) => (
              <CustomTooltip
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
          {/* Subtle Sunday indicator (follows the active metric color) */}
          {sundayDates.map((d) => (
            <ReferenceLine
              key={`sunday-${d}`}
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
            dataKey="daily"
            stroke={effectiveDailyColor}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gid})`}
            dot={(props: any) => {
              const { cx, cy, payload } = props ?? {};
              if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
              const date = String(payload?.date ?? "");
              const isSunday = date ? isSundayDate(date) : false;
              const fill = isSunday ? sundayColor : effectiveDailyColor;
              const fillOpacity = isSunday ? 0.78 : 1;
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
              const isSunday = date ? isSundayDate(date) : false;
              const fill = isSunday ? sundayColor : effectiveDailyColor;
              const fillOpacity = isSunday ? 0.85 : 1;
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
