"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useId, useEffect, useState } from "react";
import { formatInt, formatUsd } from "@/lib/format";

type MonthlyDataPoint = {
  month: string; // yyyy-mm
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

function formatMonthLabel(monthString: string): string {
  const date = new Date(`${monthString}-01`);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatTooltipMonth(monthString: string): string {
  const date = new Date(`${monthString}-01`);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function MonthlyBarChart({
  data,
  valueLabel = "Value",
  valueFormat = "int",
  yTickFormat = "k",
  color = "#c7f33c",
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
  const [isDark, setIsDark] = useState(false);

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

  // Sort data by month (ascending)
  const chartData = [...data].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <BarChart
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.8} />
              <stop offset="95%" stopColor={color} stopOpacity={0.4} />
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
            contentStyle={{
              backgroundColor: "var(--sb-card)",
              borderColor: "var(--sb-border)",
              borderRadius: "10px",
              boxShadow: "var(--sb-shadow-compact)",
              color: "var(--sb-text)",
            }}
            itemStyle={{ color: "var(--sb-text)" }}
            formatter={(value) => [fmtValue(Number(value ?? 0)), valueLabel]}
            labelFormatter={(label) => formatTooltipMonth(label)}
            cursor={{
              fill: "rgba(0,0,0,0.1)",
            }}
          />
          <Bar
            dataKey="value"
            fill={`url(#${gid})`}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
