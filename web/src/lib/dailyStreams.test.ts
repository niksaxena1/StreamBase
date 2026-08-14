import { describe, expect, it } from "vitest";

import { dailyStreamValuesForDataset, trailingDailyAverage } from "./dailyStreams";

const rowsDesc = [
  { total_streams_cumulative: 1_500_000, daily_streams_net: 20_000 },
  { total_streams_cumulative: 1_000_000, daily_streams_net: 18_000 },
  { total_streams_cumulative: 980_000, daily_streams_net: 16_000 },
];

describe("dailyStreamValuesForDataset", () => {
  it("uses membership-aware stored daily values for competitors", () => {
    expect(dailyStreamValuesForDataset(rowsDesc, "competitor")).toEqual([20_000, 18_000, 16_000]);
  });

  it("derives own-catalog values from cumulative totals, oldest row null", () => {
    expect(dailyStreamValuesForDataset(rowsDesc, "own")).toEqual([500_000, 20_000, null]);
  });

  it("does not let a competitor backfill jump leak into the daily value", () => {
    // A newly tracked playlist adds its whole lifetime total to the cumulative
    // column; the stored daily value stays at the real day-over-day movement.
    const backfill = [
      { total_streams_cumulative: 512_814_617, daily_streams_net: 1_217_814 },
      { total_streams_cumulative: 471_309_243, daily_streams_net: 1_198_002 },
    ];
    expect(dailyStreamValuesForDataset(backfill, "competitor")[0]).toBe(1_217_814);
    expect(dailyStreamValuesForDataset(backfill, "own")[0]).toBe(41_505_374);
  });

  it("treats missing values as zero rather than NaN", () => {
    expect(dailyStreamValuesForDataset([{ total_streams_cumulative: null, daily_streams_net: null }], "competitor")).toEqual([0]);
  });
});

describe("trailingDailyAverage", () => {
  it("averages the most recent window and skips nulls", () => {
    expect(trailingDailyAverage([10, 20, 30, null])).toBe(20);
  });

  it("limits the window to the requested number of days", () => {
    expect(trailingDailyAverage([10, 20, 30, 40], 2)).toBe(15);
  });

  it("returns null when there is nothing to average", () => {
    expect(trailingDailyAverage([null, null])).toBeNull();
    expect(trailingDailyAverage([])).toBeNull();
  });
});
