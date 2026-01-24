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
import { formatInt } from "@/lib/format";

type DataPoint = {
  date: string;
  value: number;
};

export function DailyStreamsChart({
  data,
  valueLabel = "Streams",
}: {
  data: DataPoint[];
  valueLabel?: string;
}) {
  // Reverse data if it's in descending order (newest first) -> charts usually need ascending
  const chartData = [...data].reverse();

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorStreams" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c7f33c" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#c7f33c" stopOpacity={0} />
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
            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
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
            formatter={(value) => [formatInt(Number(value ?? 0)), valueLabel]}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#c7f33c"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorStreams)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
