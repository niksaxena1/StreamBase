import { describe, expect, it } from "vitest";
import { prepareTimeSeries, histogramBins } from "./data";
const series = [{ key: "streams", label: "Streams", movingAverage: true }];
describe("TimeSeriesChart data prep", () => {
  it("preserves nulls and zero independently", () => {
    const { points } = prepareTimeSeries(
      [
        { date: "2024-03-05", streams: null },
        { date: "2024-03-06", streams: 0 },
      ],
      series,
    );
    expect(points[0].streams).toBeNull();
    expect(points[1].streams).toBe(0);
  });
  it("inserts missing days and shades the gap", () => {
    const { points, gaps } = prepareTimeSeries(
      [
        { date: "2024-03-05", streams: 12 },
        { date: "2024-03-08", streams: 24 },
      ],
      series,
    );
    expect(points.map((p) => p.streams)).toEqual([12, null, null, 24]);
    expect(gaps).toMatchObject([{ from: "2024-03-06", to: "2024-03-07" }]);
    expect(gaps[0].x2).toBeGreaterThan(gaps[0].x1);
  });
  it("explicit gaps break data and carry their note", () => {
    const { points, gaps } = prepareTimeSeries(
      [{ date: "2024-03-05", streams: 12 }],
      series,
      [{ from: "2024-03-05", to: "2024-03-05", label: "Collector offline" }],
    );
    expect(points[0].streams).toBeNull();
    expect(gaps[0].label).toBe("Collector offline");
  });
  it("does not shift ISO timestamps in UTC+04", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Dubai";
    try {
      const { points } = prepareTimeSeries(
        [{ date: "2024-03-05T23:59:00Z", streams: 42 }],
        series,
      );
      expect(points[0].date).toBe("2024-03-05");
      expect(points[0].timestamp).toBe(Date.UTC(2024, 2, 5));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it("requires seven consecutive known days for the moving average", () => {
    const input = Array.from({ length: 8 }, (_, i) => ({
      date: `2024-03-${String(i + 1).padStart(2, "0")}`,
      streams: i + 1,
    }));
    const { points } = prepareTimeSeries(input, series);
    expect(points[5].streams__ma7).toBeNull();
    expect(points[6].streams__ma7).toBe(4);
    input[3].streams = NaN;
    expect(prepareTimeSeries(input, series).points[7].streams__ma7).toBeNull();
  });
  it("handles empty series and multi-series nulls", () => {
    expect(prepareTimeSeries([], series)).toEqual({ points: [], gaps: [] });
    expect(
      prepareTimeSeries(
        [{ date: "2024-03-05", streams: null, tracks: 4 }],
        [...series, { key: "tracks", label: "Tracks" }],
      ).gaps,
    ).toHaveLength(0);
  });
  it("bins extrema and identical values without losing observations", () => {
    expect(
      histogramBins([1, 2, 3, 4], 3).reduce((sum, bin) => sum + bin.value, 0),
    ).toBe(4);
    expect(histogramBins([0, 0, 0])).toMatchObject([{ value: 3 }]);
  });
});
