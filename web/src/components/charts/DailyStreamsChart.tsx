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
import { useEffect, useId, useRef } from "react";
import { formatInt, formatUsd } from "@/lib/format";
import {
  extractOverrideItemsFromRechartsPayload,
  formatTooltipDateDaily,
  formatKmbTick,
  formatUsdCompact,
} from "@/components/charts/chartUtils";
import { useChartCopyToClipboard, type TooltipCopyValues } from "@/components/charts/useChartCopyToClipboard";
import { useIsDarkTheme } from "@/components/charts/useIsDarkTheme";

type DataPoint = {
  date: string;
  value: number;
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

  // Sort payload: value first, then ma7
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
  const mainValueFormatted = mainValue ? fmtValue(Number(mainValue.value ?? 0)) : null;
  const maEntry = sorted.find((e) => e.dataKey === "ma7");
  const ma7ValueFormatted = maEntry
    ? fmtValue(Math.round(Number(maEntry.value ?? 0)))
    : null;
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
        <div className="mb-2 text-xs font-medium">{formatTooltipDateDaily(label)}</div>
      )}
      {sorted.map((entry, index) => {
        const isMA = entry.dataKey === "ma7";
        const label = isMA ? "MA (7d)" : valueLabel;
        let value = fmtValue(Number(entry.value ?? 0));
        
        // Round MA7 to nearest whole number
        if (isMA) {
          const numValue = Math.round(Number(entry.value ?? 0));
          value = fmtValue(numValue);
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
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "#f59e0b" }}>
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
  );
}

export function DailyStreamsChart({
  data,
  valueLabel = "Streams",
  valueFormat = "int",
  yTickFormat = "k",
  color = "#c7f33c",
  maColor = "rgba(255,255,255,0.75)",
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
  const isDark = useIsDarkTheme();
  const { containerProps, setTooltipValues, copyModal } = useChartCopyToClipboard({ valueLabel });
  
  // Use theme-aware maColor if using default - make it very visible for debugging
  const effectiveMaColor = maColor === "rgba(255,255,255,0.75)"
    ? (isDark ? "#ffffff" : "#000000")
    : maColor;

  const annItemsByDate = new Map<string, ManualOverrideAnnotation[]>();
  for (const a of annotations ?? []) {
    if (!a?.date) continue;
    const arr = annItemsByDate.get(a.date) ?? [];
    arr.push(a);
    annItemsByDate.set(a.date, arr);
  }

  // Reverse data if it's in descending order (newest first) -> charts usually need ascending
  const chartData = [...data].reverse().map((d) => ({
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

  // Calculate Y-axis domain for cumulative charts (use exact min/max for better readability)
  const yAxisDomain = isCumulative && chartData.length > 0
    ? (() => {
        const values = chartData.map((d) => d.value).filter((v) => v != null && !isNaN(v));
        if (values.length === 0) return undefined;
        const min = Math.min(...values);
        const max = Math.max(...values);
        // Use exact min and max values - no padding, so the line fills the chart
        return [min, max];
      })()
    : undefined;

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  const ChartComponent = hasMA7 ? ComposedChart : AreaChart;

  return (
    <div
      className="w-full"
      {...containerProps}
    >
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <ChartComponent
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          style={{ outline: "none" }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
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
            content={({ active, label, payload }) => (
              <CustomTooltip
                active={active}
                label={label as string}
                payload={payload as TooltipPayload[]}
                valueLabel={valueLabel}
                fmtValue={fmtValue}
                isDark={isDark}
                chartColor={color}
                onValuesFormatted={(v) => {
                  setTooltipValues(v);
                }}
              />
            )}
            cursor={{
              stroke: color,
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
              opacity: 0.8
            }}
          />
          {annotationDates.map((d) => (
            <ReferenceLine
              key={`override-${d}`}
              x={d}
              stroke="#f59e0b"
              strokeOpacity={0.35}
              strokeWidth={2}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          ))}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gid})`}
            dot={{ r: 3, fill: color, stroke: "var(--sb-bg)", strokeWidth: 1.5 }}
            activeDot={{ r: 4, fill: color, stroke: "var(--sb-bg)", strokeWidth: 1.5 }}
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
}
