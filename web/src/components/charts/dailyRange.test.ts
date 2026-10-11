import { describe, expect, it } from "vitest";
import { clipDailyValue, formatClippedDailyValue, typicalDailyDomain } from "./dailyRange";

describe("typicalDailyDomain", () => {
  it("excludes isolated positive and negative extremes with 10% padding", () => {
    const daily = [-15_300_000, ...Array<number>(100).fill(100), 12_000_000];
    expect(typicalDailyDomain(daily)).toEqual([-10, 110]);
    expect(daily[0]).toBe(-15_300_000);
  });
  it("always includes zero and the full moving-average line", () => {
    expect(typicalDailyDomain(Array<number>(100).fill(100), [-500, 300])).toEqual([-580, 380]);
  });
  it("interpolates the 2nd and 98th percentiles of the supplied visible series", () => {
    expect(typicalDailyDomain([-100, 0, 100])).toEqual([-115.2, 115.2]);
    const domain = typicalDailyDomain([10, 20, 30]);
    expect(domain[0]).toBeCloseTo(-2.96);
    expect(domain[1]).toBeCloseTo(32.56);
  });
  it("handles missing, invalid, constant, empty and short histories", () => {
    expect(typicalDailyDomain([null, undefined, NaN, Infinity])).toEqual([0, 1]);
    expect(typicalDailyDomain([])).toEqual([0, 1]);
    expect(typicalDailyDomain([0, 0])).toEqual([-1, 1]);
    expect(typicalDailyDomain([5])).toEqual([-1, 6]);
    expect(typicalDailyDomain([-5])).toEqual([-6, 1]);
    expect(typicalDailyDomain([], [10])).toEqual([-1, 11]);
  });
});

describe("clipDailyValue", () => {
  it("caps both edges and identifies each clipped point", () => {
    expect(clipDailyValue(-15_300_000, [-10, 110])).toEqual({ value: -10, clipped: "low" });
    expect(clipDailyValue(1200, [-10, 110])).toEqual({ value: 110, clipped: "high" });
  });
  it("leaves in-range and boundary points untouched", () => {
    for (const value of [-10, 0, 42, 110]) {
      expect(clipDailyValue(value, [-10, 110])).toEqual({ value, clipped: null });
    }
  });
  it("preserves gaps instead of drawing invalid values at an edge", () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(clipDailyValue(value, [-10, 110])).toEqual({ value: null, clipped: null });
    }
  });
  it("labels the real signed value compactly", () => {
    expect(formatClippedDailyValue(-15_300_000)).toBe("−15.3M");
    expect(formatClippedDailyValue(1_200_000_000)).toBe("1.2B");
    expect(formatClippedDailyValue(-1200)).toBe("−1.2K");
    expect(formatClippedDailyValue(42)).toBe("42");
  });
});
