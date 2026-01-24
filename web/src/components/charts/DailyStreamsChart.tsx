"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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
  heightPx = 300,
}: {
  data: DataPoint[];
  valueLabel?: string;
  valueFormat?: ValueFormat;
  yTickFormat?: YTickFormat;
  color?: string;
  heightPx?: number;
}) {
  const gid = useId();
  // Reverse data if it's in descending order (newest first) -> charts usually need ascending
  const chartData = [...data].reverse();

  const fmtValue = (n: number) =>
    valueFormat === "usd" ? formatUsd(n) : formatInt(n);

  const fmtYTick = (n: number) => {
    if (yTickFormat === "int") return formatInt(n);
    if (yTickFormat === "usd_compact") return formatUsdCompact(n);
    // default: "k"
    return `${(n / 1000).toFixed(0)}k`;
  };

  return (
    <div className="w-full" style={{ height: heightPx }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
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
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
          />
          <YAxis
            stroke="var(--sb-muted)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => fmtYTick(Number(value ?? 0))}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sb-card)",
              borderColor: "var(--sb-border)",
              borderRadius: "12px",
              boxShadow: "var(--sb-shadow-soft)",
              color: "var(--sb-text)",
            }}
            itemStyle={{ color: "var(--sb-text)" }}
            formatter={(value) => [fmtValue(Number(value ?? 0)), valueLabel]}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
            cursor={{
              stroke: color,
              strokeWidth: 2,
              strokeDasharray: "5 5",
              opacity: 0.8
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={3}
            fillOpacity={1}
            fill={`url(#${gid})`}
            activeDot={{ r: 6, fill: color, stroke: "var(--sb-bg)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
