import { describe, expect, it } from "vitest";
import { buildCollectorMetricSeries, trimSeriesToVisible } from "./collectorsUtils";
import type { CollectorSeriesPoint } from "./collectorsTypes";

function point(date: string, total: number): CollectorSeriesPoint {
  return { date, track_count: 10, total_streams_cumulative: total, daily_streams_net: null, est_revenue_total: null, est_revenue_daily_net: null } as unknown as CollectorSeriesPoint;
}

describe("trimSeriesToVisible", () => {
  it("seeds the first visible delta and MA7 from warm-up rows, then hides them", () => {
    // 14 days, +100 streams per day; newest first.
    const all = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 14 - i));
      return point(d.toISOString().slice(0, 10), 10_000 - i * 100);
    });
    const visible = all.slice(0, 7);
    const trimmed = trimSeriesToVisible(buildCollectorMetricSeries(all, 0.002), visible);
    expect(trimmed.streams.daily.map((p) => p.date)).toEqual(visible.map((p) => p.date));
    const oldestVisible = trimmed.streams.daily[trimmed.streams.daily.length - 1] as { daily: number | null; ma7?: number | null };
    expect(oldestVisible.daily).toBe(100);
    expect(oldestVisible.ma7).toBe(100);
  });
});
