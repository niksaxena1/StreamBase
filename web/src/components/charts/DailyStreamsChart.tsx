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
import { useId, useEffect, useRef, useState } from "react";
import { formatInt, formatUsd } from "@/lib/format";

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

function formatUsdCompact(n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return formatUsd(n);
  }
}

function formatTooltipDate(dateString: string): string {
  const date = new Date(dateString);
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();
  
  // Add ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
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

type TooltipPayload = {
  name: string;
  value: number | string;
  dataKey: string;
};

function showCopiedToast(message: string) {
  try {
    const existing = document.getElementById("sb-copied-toast");
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.id = "sb-copied-toast";
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: #22c55e;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
  } catch {
    // ignore toast failures
  }
}

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
  onValuesFormatted?: (v: { main: string; ma7: string | null }) => void;
}) {
  if (!active || !payload || payload.length === 0) return null;

  // Sort payload: value first, then ma7
  const sorted = [...payload].sort((a, b) => {
    const aIsMA = a.dataKey === "ma7";
    const bIsMA = b.dataKey === "ma7";
    if (aIsMA && !bIsMA) return 1;
    if (!aIsMA && bIsMA) return -1;
    return 0;
  });

  const mainValue = sorted[0];
  const mainValueFormatted = fmtValue(Number(mainValue.value ?? 0));
  const maEntry = sorted.find((e) => e.dataKey === "ma7");
  const ma7ValueFormatted = maEntry
    ? fmtValue(Math.round(Number(maEntry.value ?? 0)))
    : null;
  const overrideItems:
    | Array<{ note: string; title?: string; imageUrl?: string | null }>
    | null =
    (((payload as unknown as any[])?.[0]?.payload?._overrideItems as Array<{
      note: string;
      title?: string;
      imageUrl?: string | null;
    }> | undefined) ?? null);

  // Avoid update loops by only notifying when values change.
  const lastSentKeyRef = useRef<string>("");
  useEffect(() => {
    if (!active) return;
    if (!mainValueFormatted) return;
    const key = `${mainValueFormatted}||${ma7ValueFormatted ?? ""}`;
    if (key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    onValuesFormatted?.({ main: mainValueFormatted, ma7: ma7ValueFormatted });
  }, [active, mainValueFormatted, ma7ValueFormatted, onValuesFormatted]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mainValueFormatted);
      showCopiedToast("Copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div
      className="rounded-lg border p-3 cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        backgroundColor: "var(--sb-card)",
        borderColor: "var(--sb-border)",
        boxShadow: "var(--sb-shadow-compact)",
        color: "var(--sb-text)",
      }}
      onClick={handleCopy}
    >
      {label && (
        <div className="mb-2 text-xs font-medium">{formatTooltipDate(label)}</div>
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
  const [isDark, setIsDark] = useState(false);
  const lastTooltipValuesRef = useRef<{ main: string; ma7: string | null } | null>(null);
  
  useEffect(() => {
    const checkTheme = () => {
      if (typeof window === "undefined") return;
      const html = document.documentElement;
      const theme = html.dataset.theme || 
                    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setIsDark(theme === "dark");
    };
    
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (mediaQuery) {
      mediaQuery.addEventListener("change", checkTheme);
    }
    return () => {
      observer.disconnect();
      if (mediaQuery) {
        mediaQuery.removeEventListener("change", checkTheme);
      }
    };
  }, []);
  
  // Use theme-aware maColor if using default - make it very visible for debugging
  const effectiveMaColor = maColor === "rgba(255,255,255,0.75)"
    ? (isDark ? "#ffffff" : "#000000")
    : maColor;
  
  const annByDate = new Map<string, string[]>();
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
    if (yTickFormat === "usd_compact") return formatUsdCompact(n);
    // default: "k" - format with K/M/B suffixes and commas
    const abs = Math.abs(n);
    if (abs >= 1000000000) {
      // Billions
      const billions = n / 1000000000;
      return `${billions % 1 === 0 ? billions.toFixed(0) : billions.toFixed(1)}B`;
    } else if (abs >= 1000000) {
      // Millions
      const millions = n / 1000000;
      return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
    } else if (abs >= 1000) {
      // Thousands
      const thousands = n / 1000;
      return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
    } else {
      // Less than 1000 - show with commas
      return formatInt(n);
    }
  };

  const ChartComponent = hasMA7 ? ComposedChart : AreaChart;

  return (
    <div
      className="w-full"
      onMouseDown={(e) => {
        // Prevent focus outline box on click (the chart isn't keyboard-focusable anyway).
        e.preventDefault();
      }}
      onClick={async (e) => {
        const lastTooltipValues = lastTooltipValuesRef.current;
        if (!lastTooltipValues) return;
        const wantMA = (e.ctrlKey || e.metaKey) && !!lastTooltipValues.ma7;
        const toCopy = wantMA ? lastTooltipValues.ma7 : lastTooltipValues.main;
        if (!toCopy) return;
        try {
          await navigator.clipboard.writeText(toCopy);
          showCopiedToast(wantMA ? "Copied MA to clipboard!" : "Copied to clipboard!");
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }}
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
                  lastTooltipValuesRef.current = v;
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
    </div>
  );
}
