import { describe, expect, it } from "vitest";

import { buildAdaptiveSeries } from "./aggregateSeries";
import {
  dailyValueMap,
  formatYoyPercent,
  previousYearAvailable,
  shiftIsoYears,
  shiftWindowBackOneYear,
  valueOverRange,
  withPreviousYear,
  yoyPercent,
} from "./yoyCompare";

function dailyRows(start: string, days: number, f: (i: number) => number | null) {
  const out: Array<{ date: string; daily: number | null }> = [];
  const t0 = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  for (let i = 0; i < days; i++) out.push({ date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), daily: f(i) });
  return out.reverse(); // newest first
}

describe("shiftIsoYears", () => {
  it("keeps the calendar day", () => {
    expect(shiftIsoYears("2024-09-15", -1)).toBe("2023-09-15");
    expect(shiftIsoYears("2026-01-01", -1)).toBe("2025-01-01");
  });
  it("maps 29 Feb to 28 Feb in a non-leap year and keeps it in a leap year", () => {
    expect(shiftIsoYears("2024-02-29", -1)).toBe("2023-02-28");
    expect(shiftIsoYears("2024-02-29", -4)).toBe("2020-02-29");
    expect(shiftIsoYears("2023-02-28", 1)).toBe("2024-02-28");
  });
  it("shifts windows", () => {
    expect(shiftWindowBackOneYear({ start: "2024-09-01", end: "2024-09-30" })).toEqual({ start: "2023-09-01", end: "2023-09-30" });
  });
});

describe("yoyPercent / formatYoyPercent", () => {
  it("matches the example from the spec", () => {
    expect(formatYoyPercent(yoyPercent(95166, 81020)!)).toBe("+17.5%");
  });
  it("is null when a side is missing or the previous value is zero", () => {
    expect(yoyPercent(10, 0)).toBeNull();
    expect(yoyPercent(null, 5)).toBeNull();
    expect(yoyPercent(5, null)).toBeNull();
  });
  it("formats negatives and zero", () => {
    expect(formatYoyPercent(-3.24)).toBe("-3.2%");
    expect(formatYoyPercent(0)).toBe("0.0%");
  });
});

describe("previousYearAvailable", () => {
  const rows = dailyRows("2023-09-01", 400, (i) => 100 + i);
  it("is true when the shifted window overlaps data", () => {
    expect(previousYearAvailable(rows, "daily", { start: "2024-09-01", end: "2024-09-30" })).toBe(true);
  });
  it("is true for partial overlap", () => {
    expect(previousYearAvailable(rows, "daily", { start: "2024-08-20", end: "2024-09-10" })).toBe(true);
  });
  it("is false when the shifted window has no data", () => {
    expect(previousYearAvailable(rows, "daily", { start: "2023-10-01", end: "2023-10-30" })).toBe(false);
  });
  it("ignores null values and a missing window", () => {
    const nulls = dailyRows("2023-09-01", 400, () => null);
    expect(previousYearAvailable(nulls, "daily", { start: "2024-09-01", end: "2024-09-30" })).toBe(false);
    expect(previousYearAvailable(rows, "daily", null)).toBe(false);
  });
});

describe("valueOverRange", () => {
  const map = new Map([["2023-09-04", 10], ["2023-09-05", 20], ["2023-09-07", 60]]);
  it("averages days with data and ignores gaps", () => {
    expect(valueOverRange(map, "2023-09-04", "2023-09-10", "average")).toBe(30);
  });
  it("returns the last value for cumulative series", () => {
    expect(valueOverRange(map, "2023-09-04", "2023-09-10", "last")).toBe(60);
  });
  it("is null without data", () => {
    expect(valueOverRange(map, "2023-10-01", "2023-10-07", "average")).toBeNull();
  });
});

describe("withPreviousYear", () => {
  const all = dailyRows("2023-01-01", 800, (i) => (i === 10 ? null : 1000 + i));
  it("aligns daily rows to the same calendar day a year earlier", () => {
    const window = { start: "2024-09-10", end: "2024-09-16" };
    const series = buildAdaptiveSeries({ rowsDesc: all, valueKey: "daily", isCumulative: false, window, mode: "auto" });
    const rows = withPreviousYear({ displayRows: series.rowsDesc, allRows: all, valueKey: "daily", isCumulative: false, granularity: "daily" });
    expect(rows).toHaveLength(7);
    const day = rows.find((r) => r.date === "2024-09-15")!;
    const map = dailyValueMap(all, "daily");
    expect(day._prevDate).toBe("2023-09-15");
    expect(day._prevValue).toBe(map.get("2023-09-15"));
    expect(day._yoyPct).toBeCloseTo(((map.get("2024-09-15")! - map.get("2023-09-15")!) / map.get("2023-09-15")!) * 100, 6);
    expect(day._prevLabel).toBe("Fri 15 Sep 2023");
  });
  it("gives null for a day whose previous-year value is a gap", () => {
    const rows = withPreviousYear({
      displayRows: [{ date: "2024-01-11" }],
      allRows: all,
      valueKey: "daily",
      isCumulative: false,
      granularity: "daily",
    });
    expect(rows[0]._prevDate).toBe("2023-01-11");
    expect(rows[0]._prevValue).toBeNull();
    expect(rows[0]._yoyPct).toBeNull();
  });
  it("uses the same granularity for weekly buckets (average per covered day)", () => {
    const window = { start: "2024-03-01", end: "2025-02-28" };
    const series = buildAdaptiveSeries({ rowsDesc: all, valueKey: "daily", isCumulative: false, window, mode: "weekly" });
    const rows = withPreviousYear({ displayRows: series.rowsDesc, allRows: all, valueKey: "daily", isCumulative: false, granularity: "weekly" });
    const bucket = rows.find((r) => r.date === "2024-09-09")!; // a Monday
    expect(bucket._prevDate).toBe("2023-09-09");
    const map = dailyValueMap(all, "daily");
    const expected = valueOverRange(map, "2023-09-09", "2023-09-15", "average");
    expect(bucket._prevValue).toBeCloseTo(expected!, 9);
    expect(bucket._prevLabel).toBe("Week of 9 Sep 2023");
  });
  it("uses the last value for monthly cumulative buckets", () => {
    const cumulative = dailyRows("2023-01-01", 800, (i) => 5000 + i * 10).map((r) => ({ date: r.date, value: r.daily }));
    const series = buildAdaptiveSeries({ rowsDesc: cumulative, valueKey: "value", isCumulative: true, window: null, mode: "monthly" });
    const rows = withPreviousYear({ displayRows: series.rowsDesc, allRows: cumulative, valueKey: "value", isCumulative: true, granularity: "monthly" });
    const sep24 = rows.find((r) => r.date === "2024-09-01")!;
    const map = dailyValueMap(cumulative, "value");
    expect(sep24._prevValue).toBe(map.get("2023-09-30"));
    expect(sep24._prevLabel).toBe("September 2023");
  });
});
