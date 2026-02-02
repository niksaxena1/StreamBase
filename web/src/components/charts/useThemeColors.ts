"use client";

import { useEffect, useState } from "react";

/**
 * Theme-aware color palette for charts and components.
 * Reads CSS variables from the document root, reacting to theme changes.
 */
export interface ThemeColors {
  /** Primary accent color (lime green) - use for fills and glows */
  accent: string;
  /** Accent stroke - slightly darker in light mode for better contrast on thin lines */
  accentStroke: string;
  /** Soft accent for backgrounds */
  accentSoft: string;
  /** Positive value color (daily streams, revenue gains) */
  positive: string;
  /** Positive hover/muted state */
  positiveMuted: string;
  /** Revenue color (emerald) */
  revenue: string;
  /** Tracks metric color (blue) */
  tracks: string;
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
  positive: "#4d7c0f",
  positiveMuted: "#65a30d",
  revenue: "#10b981",
  tracks: "#3b82f6",
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
  positive: "#a3e635",
  positiveMuted: "#84cc16",
  revenue: "#10b981",
  tracks: "#3b82f6",
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
    positive: getCSSVar("--sb-positive") ?? defaults.positive,
    positiveMuted: getCSSVar("--sb-positive-muted") ?? defaults.positiveMuted,
    revenue: "#10b981", // emerald-500 - consistent across themes
    tracks: "#3b82f6", // blue-500 - consistent across themes
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
 * @param metric - The metric type: "streams", "revenue", or "tracks"
 * @param colors - Theme colors from useThemeColors()
 * @returns The color to use for the chart
 */
export function getChartColor(
  metric: "streams" | "revenue" | "tracks",
  colors: ThemeColors
): string {
  switch (metric) {
    case "revenue":
      return colors.revenue;
    case "tracks":
      return colors.tracks;
    case "streams":
    default:
      return colors.accentStroke;
  }
}
