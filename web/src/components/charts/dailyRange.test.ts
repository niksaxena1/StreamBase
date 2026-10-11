import { describe, expect, it } from "vitest";
import { clipDailySeries, clipDailyValue, typicalDailyDomain } from "./dailyRange";

describe("typicalDailyDomain", () => {
  it("rejects both isolated extremes in a 30-day window", () => {
    const daily = [-15_000_000, ...Array<number>(28).fill(1_000_000), 12_000_000];
    const domain = typicalDailyDomain(daily);
    expect(domain).toEqual([640_000, 1_360_000]);
    const clipped = clipDailySeries(daily, domain);
    expect(clipped[0]).toEqual({ value: 640_000, clipped: "low", showLabel: true });
    expect(clipped[29]).toEqual({ value: 1_360_000, clipped: "high", showLabel: true });
    expect(clipped.slice(1, 29).every((point) => point.clipped === null)).toBe(true);
    expect(daily[0]).toBe(-15_000_000);
  });
  it("clips a moving-average spike without widening the daily domain", () => {
    const domain = typicalDailyDomain(Array<number>(30).fill(1_000_000));
    const movingAverage = clipDailySeries([1_000_000, 5_000_000, -3_000_000, null], domain);
    expect(domain).toEqual([640_000, 1_360_000]);
    expect(movingAverage[1]).toEqual({ value: 1_360_000, clipped: "high", showLabel: true });
    expect(movingAverage[2]).toEqual({ value: 640_000, clipped: "low", showLabel: false });
    expect(movingAverage[3]).toEqual({ value: null, clipped: null, showLabel: false });
  });
  it("includes zero when typical values are near it", () => {
    const domain = typicalDailyDomain([-1, 0, 1]);
    expect(domain[0]).toBeLessThan(0);
    expect(domain[1]).toBeGreaterThan(0);
  });
  it("does not force zero into a flat series far above or below it", () => {
    expect(typicalDailyDomain(Array<number>(30).fill(100))).toEqual([64, 136]);
    expect(typicalDailyDomain(Array<number>(30).fill(-100))).toEqual([-136, -64]);
  });
  it("handles an all-zero series with a finite, non-zero domain", () => {
    expect(typicalDailyDomain(Array<number>(30).fill(0))).toEqual([-2, 2]);
  });
  it("handles a single point using the MAD floor", () => {
    expect(typicalDailyDomain([1_000_000])).toEqual([640_000, 1_360_000]);
    expect(typicalDailyDomain([0])).toEqual([-2, 2]);
  });
  it("ignores invalid or missing samples", () => {
    expect(typicalDailyDomain([null, undefined, NaN, Infinity])).toEqual([0, 1]);
    expect(typicalDailyDomain([])).toEqual([0, 1]);
    expect(typicalDailyDomain([null, 100, NaN])).toEqual([64, 136]);
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

});

describe("clipDailySeries label runs", () => {
  it("labels only the largest magnitude in each adjacent clipped run", () => {
    const clipped = clipDailySeries([-1500, -3000, 5000, 0, 3000, 2000], [-10, 110]);
    expect(clipped.map((point) => point.showLabel)).toEqual([false, false, true, false, true, false]);
    expect(clipped.filter((point) => point.clipped)).toHaveLength(5);
  });
  it("breaks runs at gaps and keeps the first label when magnitudes tie", () => {
    const clipped = clipDailySeries([-1500, -1500, null, 3000, 3000], [-10, 110]);
    expect(clipped.map((point) => point.showLabel)).toEqual([true, false, false, true, false]);
  });
});
