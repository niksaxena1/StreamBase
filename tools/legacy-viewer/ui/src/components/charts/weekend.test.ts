import { describe, expect, it } from "vitest";
import {
  prepareTimeSeries,
  weekendBands,
  zoomWindow,
  type PreparedPoint,
} from "./data";

const DAY = 86_400_000;
const days = (start: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const timestamp = Date.parse(`${start}T00:00:00Z`) + i * DAY;
    return { date: new Date(timestamp).toISOString().slice(0, 10), timestamp };
  });

describe("weekend bands", () => {
  it("merges Saturday+Sunday into one band framing the bars", () => {
    // 2025-03-01 is a Saturday
    const bands = weekendBands(days("2025-03-03", 14)); // Mon 3 Mar .. Sun 16 Mar
    expect(bands.map((b) => [b.from, b.to])).toEqual([
      ["2025-03-08", "2025-03-09"],
      ["2025-03-15", "2025-03-16"],
    ]);
    const first = days("2025-03-08", 1)[0].timestamp;
    expect(bands[0].x1).toBe(first - DAY / 2);
    expect(bands[0].x2).toBe(first + DAY + DAY / 2);
  });
  it("keeps edge days alone and ignores weekdays", () => {
    expect(weekendBands(days("2025-03-02", 1))).toMatchObject([{ from: "2025-03-02", to: "2025-03-02" }]); // Sunday
    expect(weekendBands(days("2025-03-03", 5))).toEqual([]); // Mon-Fri
    const bands = weekendBands(days("2025-03-07", 4)); // Fri..Mon
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ from: "2025-03-08", to: "2025-03-09" });
  });
  it("uses UTC days regardless of the viewer's timezone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      expect(weekendBands(days("2025-03-08", 2))).toHaveLength(1);
    } finally {
      process.env.TZ = previous;
    }
  });
  it("is only for daily grain", () => {
    expect(weekendBands(days("2025-03-03", 14), 7)).toEqual([]);
    expect(weekendBands(days("2025-03-03", 14), 32)).toEqual([]);
  });
  it("works on prepared series with injected gap days", () => {
    const { points } = prepareTimeSeries(
      [
        { date: "2025-03-07", delta: 5 },
        { date: "2025-03-10", delta: 6 },
      ],
      [{ key: "delta", label: "Daily change" }],
    );
    expect(weekendBands(points as PreparedPoint[])).toMatchObject([{ from: "2025-03-08", to: "2025-03-09" }]);
  });
});

describe("zoom window", () => {
  const points = days("2024-01-01", 400);
  const last = points[points.length - 1].timestamp;
  it("focuses the trailing days, or everything", () => {
    expect(zoomWindow(points, "all")).toBeNull();
    expect(zoomWindow(points, "30d")).toEqual({ from: last - 29 * DAY, to: last });
    expect(zoomWindow(points, "90d")?.from).toBe(last - 89 * DAY);
    expect(zoomWindow(points, "1y")?.from).toBe(last - 364 * DAY);
  });
  it("shows everything when the data is shorter than the window", () => {
    expect(zoomWindow(days("2024-01-01", 20), "30d")).toBeNull();
    expect(zoomWindow([], "30d")).toBeNull();
  });
  it("zooms to a selection with a little context, clamped to the data", () => {
    const w = zoomWindow(points, "selection", { from: "2024-03-01", to: "2024-03-31" });
    expect(w).not.toBeNull();
    expect(w!.from).toBeLessThan(Date.parse("2024-03-01T00:00:00Z"));
    expect(w!.to).toBeGreaterThan(Date.parse("2024-03-31T00:00:00Z"));
    expect(w!.from).toBeGreaterThanOrEqual(points[0].timestamp);
    const edge = zoomWindow(points, "selection", { from: "2024-01-01", to: "2024-01-03" });
    expect(edge!.from).toBe(points[0].timestamp);
    expect(edge!.to - edge!.from).toBeGreaterThanOrEqual(6 * DAY);
    expect(zoomWindow(points, "selection")).toBeNull();
  });
});

describe("7-day average rule", () => {
  const rows = (values: (number | null)[]) =>
    values.map((delta, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), delta }));
  const ma = (values: (number | null)[], min?: number) =>
    prepareTimeSeries(
      rows(values),
      [{ key: "delta", label: "d", movingAverage: true, movingAverageMinKnown: min }],
    ).points.map((p) => p.delta__ma7);
  it("keeps the strict seven-of-seven default", () => {
    expect(ma([1, 2, 3, 4, 5, 6, 7])[6]).toBe(4);
    expect(ma([1, 2, null, 4, 5, 6, 7])[6]).toBeNull();
  });
  it("matches the API rule with four known days of seven", () => {
    const values = ma([2, null, 4, null, 6, null, 8], 4);
    expect(values[6]).toBe(5); // mean of the four known values, missing days are not zeros
    expect(ma([2, null, null, null, 6, null, 8], 4)[6]).toBeNull();
    expect(values.slice(0, 6).every((v) => v === null)).toBe(true);
  });
});
