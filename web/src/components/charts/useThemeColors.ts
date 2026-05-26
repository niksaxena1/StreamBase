"use client";

import { useEffect, useState } from "react";

/**
 * Theme-aware color palette for charts and components.
 * Reads CSS variables from the document root, reacting to theme changes.
 */
export interface ThemeColors {
  /** Brand/chrome accent (lime in own catalog; competitor tint in competitor mode). Not for chart series. */
  accent: string;
  /** Brand/chrome stroke — UI chrome only, not chart series. */
  accentStroke: string;
  /** Soft accent for backgrounds */
  accentSoft: string;
  /** 10% opacity accent for subtle backgrounds */
  accent10: string;
  /** 20% opacity accent for borders */
  accent20: string;
  /** Positive value color (daily streams, revenue gains) */
  positive: string;
  /** Positive hover/muted state */
  positiveMuted: string;
  /** Revenue color (emerald) - for financial/revenue data */
  revenue: string;
  /** Tracks metric color (blue) - for track count/catalog data */
  tracks: string;
  /** Warning color (amber) - for warnings/overrides */
  warning: string;
  /** Error color (red) - for errors/negative trends */
  error: string;
  /** Info color (indigo) - for informational elements */
  info: string;
  /** Main text color */
  text: string;
  /** Muted/secondary text */
  muted: string;
  /** Background color */
  bg: string;
  /** Card background */
  card: string;
  /** Border color */
  border: string;
  /** Whether dark mode is active */
  isDark: boolean;
}

// Fallback colors (light mode defaults)
const LIGHT_DEFAULTS: ThemeColors = {
  accent: "#c7f33c",
  accentStroke: "#a8d62e",
  accentSoft: "#e1f2ae",
  accent10: "rgba(199, 243, 60, 0.1)",
  accent20: "rgba(199, 243, 60, 0.2)",
  positive: "#4d7c0f",
  positiveMuted: "#65a30d",
  revenue: "#10b981",
  tracks: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#6366f1",
  text: "#0b0b0c",
  muted: "rgba(0, 0, 0, 0.55)",
  bg: "#ececec",
  card: "rgba(255, 255, 255, 0.92)",
  border: "rgba(0, 0, 0, 0.08)",
  isDark: false,
};

const DARK_DEFAULTS: ThemeColors = {
  accent: "#d4ff4d",
  accentStroke: "#d4ff4d",
  accentSoft: "#e1f2ae",
  accent10: "rgba(212, 255, 77, 0.1)",
  accent20: "rgba(212, 255, 77, 0.2)",
  positive: "#a3e635",
  positiveMuted: "#84cc16",
  revenue: "#34d399",
  tracks: "#60a5fa",
  warning: "#fbbf24",
  error: "#f87171",
  info: "#818cf8",
  text: "#ededed",
  muted: "rgba(255, 255, 255, 0.5)",
  bg: "#0a0a0c",
  card: "rgba(20, 20, 25, 0.85)",
  border: "rgba(255, 255, 255, 0.08)",
  isDark: true,
};

function getCSSVar(name: string): string | null {
  if (typeof window === "undefined") return null;
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name).trim();
  return value || null;
}

function getThemeColors(isDark: boolean): ThemeColors {
  const defaults = isDark ? DARK_DEFAULTS : LIGHT_DEFAULTS;

  return {
    accent: getCSSVar("--sb-accent") ?? defaults.accent,
    accentStroke: getCSSVar("--sb-accent-stroke") ?? defaults.accentStroke,
    accentSoft: getCSSVar("--sb-accent-soft") ?? defaults.accentSoft,
    accent10: getCSSVar("--sb-accent-10") ?? defaults.accent10,
    accent20: getCSSVar("--sb-accent-20") ?? defaults.accent20,
    positive: getCSSVar("--sb-positive") ?? defaults.positive,
    positiveMuted: getCSSVar("--sb-positive-muted") ?? defaults.positiveMuted,
    revenue: getCSSVar("--sb-revenue") ?? defaults.revenue,
    tracks: getCSSVar("--sb-tracks") ?? defaults.tracks,
    warning: getCSSVar("--sb-warning") ?? defaults.warning,
    error: getCSSVar("--sb-error") ?? defaults.error,
    info: getCSSVar("--sb-info") ?? defaults.info,
    text: getCSSVar("--sb-text") ?? defaults.text,
    muted: getCSSVar("--sb-muted") ?? defaults.muted,
    bg: getCSSVar("--sb-bg") ?? defaults.bg,
    card: getCSSVar("--sb-card") ?? defaults.card,
    border: getCSSVar("--sb-border") ?? defaults.border,
    isDark,
  };
}

/**
 * Hook that provides theme-aware colors for charts and components.
 * Automatically updates when the theme changes.
 */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(LIGHT_DEFAULTS);

  useEffect(() => {
    const updateColors = () => {
      if (typeof window === "undefined") return;
      const html = document.documentElement;
      const theme =
        html.dataset.theme ||
        (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const isDark = theme === "dark";
      setColors(getThemeColors(isDark));
    };

    updateColors();

    // Watch for theme changes
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (mediaQuery) {
      mediaQuery.addEventListener("change", updateColors);
    }

    return () => {
      observer.disconnect();
      if (mediaQuery) {
        mediaQuery.removeEventListener("change", updateColors);
      }
    };
  }, []);

  return colors;
}

/**
 * Get the appropriate chart color based on metric type.
 * @param metric - The metric type: "streams", "revenue", "tracks", "warning", "error", or "info"
 * @param colors - Theme colors from useThemeColors()
 * @returns The color to use for the chart
 */
export type ChartMetric = "streams" | "revenue" | "tracks" | "warning" | "error" | "info";

export function getChartColor(metric: ChartMetric, colors: ThemeColors): string {
  switch (metric) {
    case "revenue":
      return colors.revenue;
    case "tracks":
      return colors.tracks;
    case "warning":
      return colors.warning;
    case "error":
      return colors.error;
    case "info":
      return colors.info;
    case "streams":
    default:
      return colors.positive;
  }
}

/** Infer chart metric from InteractiveChartSection-style labels. */
export function inferChartMetricFromLabels(
  valueFormat: "int" | "usd",
  valueLabel: string,
): ChartMetric {
  if (valueFormat === "usd") return "revenue";
  if (valueLabel === "Tracks" || valueLabel.startsWith("Track")) return "tracks";
  return "streams";
}

/**
 * Common chart tooltip styles - use this for consistent tooltip styling.
 * @param colors - Theme colors from useThemeColors()
 */
export function getChartTooltipStyle(colors: ThemeColors): React.CSSProperties {
  return {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: "10px",
    boxShadow: "var(--sb-shadow-compact)",
    color: colors.text,
  };
}

/**
 * Common chart axis styles.
 * @param colors - Theme colors from useThemeColors()
 */
export function getChartAxisStyle(colors: ThemeColors) {
  return {
    stroke: colors.muted,
    fontSize: 10,
    tickLine: false,
    axisLine: false,
  };
}
