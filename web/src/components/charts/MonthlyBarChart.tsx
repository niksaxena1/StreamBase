"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useId } from "react";
import { formatInt, formatUsd } from "@/lib/format";
import { formatKmbTick, formatUsdCompact } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";

export type MonthlyDataPoint = {
  month: string; // yyyy-mm
  value: number;
  /** Extra amount above actual value representing the projected remainder (only for current/incomplete month) */
  projectedExtra?: number;
  /** Full projected value for the complete month (only for current/incomplete month) */
  projectedTotal?: number;
  /** Number of days with data in this month (only for current/incomplete month) */
  daysWithData?: number;
  /** Total calendar days in this month (only for current/incomplete month) */
  totalDaysInMonth?: number;
};

type ValueFormat = "int" | "usd";
type YTickFormat = "k" | "int" | "usd_compact";

function MonthlyTooltip({
  active,
  label,
  payload,
  valueLabel,
  fmtValue,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ value?: unknown; payload?: MonthlyDataPoint }>;
  valueLabel: string;
  fmtValue: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;

  // Get the data point from the first payload entry (both stacked bars share it)
  const dp = payload[0]?.payload;
  const value = Number.isFinite(dp?.value) ? fmtValue(dp!.value) : fmtValue(0);
  const hasProjection = (dp?.projectedExtra ?? 0) > 0;

  return (
    <ViewportAwareTooltip>
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{
          backgroundColor: "var(--sb-card)",
          borderColor: "var(--sb-border)",
          borderRadius: "10px",
          boxShadow: "var(--sb-shadow-compact)",
          color: "var(--sb-text)",
        }}
      >
        <div className="mb-1 font-medium">{label ? formatTooltipMonth(label) : "—"}</div>
        <div>
          {valueLabel}: <span className="font-semibold">{value}</span>
          {hasProjection && dp?.daysWithData != null && dp?.totalDaysInMonth != null && (
            <span className="ml-1 opacity-50">
              ({dp.daysWithData}/{dp.totalDaysInMonth} days)
            </span>
          )}
        </div>
        {hasProjection && dp?.projectedTotal != null && (
          <div
            className="mt-1 opacity-70"
            style={{ borderTop: "1px dashed var(--sb-border)", paddingTop: 4 }}
          >
            Est. full month:{" "}
            <span className="font-semibold">{fmtValue(dp.projectedTotal)}</span>
          </div>
        )}
      </div>
    </ViewportAwareTooltip>
  );
}

function formatMonthLabel(monthString: string): string {
  const date = new Date(`${monthString}-01`);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatTooltipMonth(monthString: string): string {
  const date = new Date(`${monthString}-01`);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ── Custom bar shapes ─────────────────────────────────────── */

/** Build an SVG path with rounded top corners and flat bottom. Falls back to plain rect for tiny heights. */
function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h < r * 2) {
    return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
  }
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h}`,
    `Z`,
  ].join(" ");
}

/** Solid bar for the actual value. Flat-tops when a projected bar sits above it. */
function ActualBarShape(props: any) {
  const { x, y, width, height, fill } = props;
  if (!width || !height || height <= 0) return null;
  const hasProjection = (props.payload?.projectedExtra ?? 0) > 0;
  if (hasProjection) {
    // Flat top — the projected bar on top will carry the rounded corners
    return <rect x={x} y={y} width={width} height={height} fill={fill} />;
  }
  return <path d={roundedTopPath(x, y, width, height, 4)} fill={fill} />;
}

/** Dashed / faded bar for the projected remainder. Opacity scales with data confidence. */
function ProjectedBarShape(props: any) {
  const { x, y, width, height, fill, payload } = props;
  if (!width || !height || height <= 0 || !(payload?.projectedExtra > 0)) return null;

  const confidence =
    payload.daysWithData && payload.totalDaysInMonth
      ? payload.daysWithData / payload.totalDaysInMonth
      : 0;

  // More days of data → higher confidence → more visible outline
  const fillOpacity = 0.05 + confidence * 0.13;
  const strokeOpacity = 0.25 + confidence * 0.45;

  return (
    <path
      d={roundedTopPath(x, y, width, height, 4)}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={fill}
      strokeOpacity={strokeOpacity}
      strokeWidth={1.5}
      strokeDasharray="4 3"
    />
  );
}

/* ── Component ─────────────────────────────────────────────── */

export function MonthlyBarChart({
  data,
  valueLabel = "Value",
  valueFormat = "int",
  yTickFormat = "k",
  color,
  heightPx = 220,
}: {
  data: MonthlyDataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  color?: string;
  heightPx?: number;
}) {
  const gid = useId();
  const themeColors = useThemeColors();
  // Use theme-aware colors from CSS variables
  const effectiveColor = color ?? themeColors.accentStroke;

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  // Sort data by month (ascending) and ensure projectedExtra defaults to 0 for stacking
  const chartData = [...data]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((d) => ({ ...d, projectedExtra: d.projectedExtra ?? 0 }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <BarChart
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={effectiveColor} stopOpacity={0.8} />
              <stop offset="95%" stopColor={effectiveColor} stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--sb-border)"
          />
          <XAxis
            dataKey="month"
            tickFormatter={(value) => formatMonthLabel(value)}
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
            content={({ active, label, payload }) => (
              <MonthlyTooltip
                active={active}
                label={label as string}
                payload={payload as Array<{ value?: unknown; payload?: MonthlyDataPoint }>}
                valueLabel={valueLabel}
                fmtValue={fmtValue}
              />
            )}
            cursor={{
              fill: "rgba(0,0,0,0.1)",
            }}
          />
          {/* Actual value — solid gradient fill */}
          <Bar
            dataKey="value"
            stackId="monthly"
            fill={`url(#${gid})`}
            shape={ActualBarShape}
          />
          {/* Projected remainder — dashed outline, faded fill, confidence-scaled opacity */}
          <Bar
            dataKey="projectedExtra"
            stackId="monthly"
            fill={effectiveColor}
            shape={ProjectedBarShape}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
