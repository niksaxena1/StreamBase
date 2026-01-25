"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useId } from "react";
import { formatInt, formatUsd } from "@/lib/format";

type DataPoint = {
  date: string;
  value: number;
  ma7?: number | null;
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

export function DailyStreamsChart({
  data,
  valueLabel = "Streams",
  valueFormat = "int",
  yTickFormat = "k",
  color = "#c7f33c",
  maColor = "rgba(0,0,0,0.5)",
  heightPx = 220,
  showMA7 = false,
}: {
  data: DataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  color?: string;
  maColor?: string;
  heightPx?: number;
  showMA7?: boolean;
}) {
  const gid = useId();
  // Reverse data if it's in descending order (newest first) -> charts usually need ascending
  const chartData = [...data].reverse();
  const hasMA7 = showMA7 && chartData.some((d) => d.ma7 !== null && d.ma7 !== undefined);

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n);
    // default: "k"
    return `${(n / 1000).toFixed(0)}k`;
  };

  const ChartComponent = hasMA7 ? ComposedChart : AreaChart;

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <ChartComponent
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
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
              return `${date.getMonth() + 1}/${date.getDate()}`;
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
            contentStyle={{
              backgroundColor: "var(--sb-card)",
              borderColor: "var(--sb-border)",
              borderRadius: "10px",
              boxShadow: "var(--sb-shadow-compact)",
              color: "var(--sb-text)",
            }}
            itemStyle={{ color: "var(--sb-text)" }}
            formatter={(value, name) => {
              const label = name === "ma7" ? "MA (7d)" : valueLabel;
              return [fmtValue(Number(value ?? 0)), label];
            }}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
            cursor={{
              stroke: color,
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
              opacity: 0.8
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gid})`}
            activeDot={{ r: 4, fill: color, stroke: "var(--sb-bg)", strokeWidth: 1.5 }}
          />
          {hasMA7 && (
            <Line
              type="monotone"
              dataKey="ma7"
              stroke={maColor}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
