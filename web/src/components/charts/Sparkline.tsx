"use client";

import { useId } from "react";
import { useThemeColors } from "@/components/charts/useThemeColors";

export function Sparkline({
  data,
  trend = "neutral",
  className,
  color,
  upColor,
}: {
  data?: number[];
  trend?: "up" | "down" | "neutral";
  className?: string;
  color?: string; // Custom color for the sparkline
  upColor?: string; // Optional override for the "up" (green) color only
}) {
  const gid = useId();
  const themeColors = useThemeColors();

  // If we have real data, use it
  if (data && data.length >= 2) {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 30;
    const padding = 2;

    // Create SVG path from data
    const points = data.map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const pathD = `M ${points.join(" L ")}`;
    const areaPath = `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

    // Determine color based on trend direction or custom color
    const first = data[0];
    const last = data[data.length - 1];
    const isUp = last > first;
    const lineColor =
      color || (isUp ? upColor ?? themeColors.accentStroke : trend === "down" ? "#ff4d4d" : "currentColor");

    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={["overflow-visible", className].filter(Boolean).join(" ")}
      >
        {isUp && (
          <path
            d={areaPath}
            fill={`url(#${gid}-up)`}
            stroke="none"
            opacity="0.2"
          />
        )}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <defs>
          <linearGradient id={`${gid}-up`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  // Fallback to static mock data paths
  const paths = {
    up: "M0 25 C10 25 10 20 20 20 C30 20 30 15 40 15 C50 15 50 5 60 5 C70 5 70 0 80 0",
    down: "M0 5 C10 5 10 10 20 10 C30 10 30 15 40 15 C50 15 50 20 60 20 C70 20 70 25 80 25",
    neutral: "M0 15 C20 15 20 10 40 15 C60 20 60 10 80 15",
  } as const;

  const lineColor =
    color || (trend === "up" ? upColor ?? themeColors.accentStroke : trend === "down" ? "#ff4d4d" : "currentColor");

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 80 30"
      preserveAspectRatio="none"
      className={["overflow-visible", className].filter(Boolean).join(" ")}
    >
      <path
        d={paths[trend]}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {trend === "up" && (
        <path
          d={`${paths[trend]} L 80 30 L 0 30 Z`}
          fill={`url(#${gid}-up)`}
          stroke="none"
          opacity="0.2"
        />
      )}
      <defs>
        <linearGradient id={`${gid}-up`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

