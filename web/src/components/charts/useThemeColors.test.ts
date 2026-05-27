import { describe, expect, it } from "vitest";

import {
  getChartColor,
  getStreamSeriesColor,
  inferChartMetricFromLabels,
  type ThemeColors,
} from "@/components/charts/useThemeColors";

const LIGHT: ThemeColors = {
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

describe("getStreamSeriesColor", () => {
  it("uses competitor accent for stream series in competitor mode", () => {
    const colors = { ...LIGHT, accent: "#fd0280" } as ThemeColors;
    expect(getStreamSeriesColor(colors, { datasetMode: "competitor" })).toBe("#fd0280");
    expect(getStreamSeriesColor(colors, { datasetMode: "competitor" })).not.toBe(LIGHT.positive);
  });

  it("keeps semantic green in own catalog", () => {
    expect(getStreamSeriesColor(LIGHT, { datasetMode: "own" })).toBe(LIGHT.positive);
  });
});

describe("getChartColor", () => {
  it("uses semantic positive for streams, not chrome accent", () => {
    expect(getChartColor("streams", LIGHT)).toBe(LIGHT.positive);
    expect(getChartColor("streams", LIGHT)).not.toBe(LIGHT.accentStroke);
  });

  it("maps revenue and tracks to their semantic tokens", () => {
    expect(getChartColor("revenue", LIGHT)).toBe(LIGHT.revenue);
    expect(getChartColor("tracks", LIGHT)).toBe(LIGHT.tracks);
  });
});

describe("inferChartMetricFromLabels", () => {
  it("infers metric from value format and labels", () => {
    expect(inferChartMetricFromLabels("usd", "Revenue")).toBe("revenue");
    expect(inferChartMetricFromLabels("int", "Tracks")).toBe("tracks");
    expect(inferChartMetricFromLabels("int", "Streams")).toBe("streams");
  });
});
