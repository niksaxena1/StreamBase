import { describe, expect, it } from "vitest";

import { EARLIEST_HISTORY_DATE_ISO, planGoTo } from "./aggregateSeries";
import { chartClipOverrideIso } from "./chartClip";
import { computeRollingAvg7, filterDailySeriesFromIsoDate } from "./chartUtils";
import { dailyStreamValuesForMixedOwnHistory } from "@/lib/dailyStreams";

describe("chartClipOverrideIso (bug 1: global chart start date clip)", () => {
  it("keeps the user's start date for the standard 30/90/365-day views", () => {
    for (const rangeDays of [7, 30, 90, 365]) {
      expect(chartClipOverrideIso({ rangeDays })).toBeNull();
      expect(chartClipOverrideIso({ rangeDays, archivedHistory: false })).toBeNull();
    }
  });

  it("never clips an explicit long range or Archived history", () => {
    expect(chartClipOverrideIso({ rangeDays: 366 })).toBe(EARLIEST_HISTORY_DATE_ISO);
    expect(chartClipOverrideIso({ rangeDays: 1200 })).toBe(EARLIEST_HISTORY_DATE_ISO);
    expect(chartClipOverrideIso({ rangeDays: 30, archivedHistory: true })).toBe(EARLIEST_HISTORY_DATE_ISO);
  });

  it("the override date keeps every archived day when used as the clip", () => {
    const rows = [{ date: "2026-02-01" }, { date: "2025-06-01" }, { date: EARLIEST_HISTORY_DATE_ISO }];
    const iso = chartClipOverrideIso({ rangeDays: 1200, archivedHistory: true });
    expect(filterDailySeriesFromIsoDate(rows, iso)).toHaveLength(3);
    expect(filterDailySeriesFromIsoDate(rows, "2026-01-28")).toHaveLength(1);
  });
});

describe("planGoTo (bug 2: Go to date must never fail silently)", () => {
  const loaded = { start: "2026-01-22", end: "2026-10-12" };
  const archived = { start: EARLIEST_HISTORY_DATE_ISO, end: "2026-10-12" };

  it("rejects dates before the earliest data with a message", () => {
    expect(planGoTo("2023-07-07", archived, true)).toEqual({ action: "reject", message: "No data before 8 Jul 2023" });
    expect(planGoTo("1999-01-01", null, true)).toEqual({ action: "reject", message: "No data before 8 Jul 2023" });
  });

  it("loads more history when the date is loadable but not loaded", () => {
    expect(planGoTo("2023-07-19", loaded, true)).toEqual({ action: "load", target: "2023-07-19" });
  });

  it("applies directly once the date is inside the loaded data", () => {
    expect(planGoTo("2023-07-19", archived, true)).toEqual({ action: "apply", target: "2023-07-19", message: null });
  });

  it("explains when nothing more can be loaded instead of doing nothing", () => {
    expect(planGoTo("2024-01-01", loaded, false)).toEqual({
      action: "apply",
      target: "2024-01-01",
      message: "Earliest data here is 22 Jan 2026",
    });
  });

  it("rejects dates after the latest data", () => {
    expect(planGoTo("2026-12-01", loaded, true)).toEqual({ action: "reject", message: "No data after 12 Oct 2026" });
  });
});

describe("Home archived series (bug 3: 305M spike at the first visible point)", () => {
  // Real shape of the data: archive ends 2025-12-22, live starts 2026-01-24 and its stored "delta" is the whole total.
  const row = (date: string, total: number, net: number | null, source: "archive" | "live") => ({
    date,
    total_streams_cumulative: total,
    daily_streams_net: net,
    history_source: source,
  });
  const live: ReturnType<typeof row>[] = [];
  let total = 2_119_055_795;
  live.push(row("2026-01-24", total, total, "live"));
  for (let day = 25; day <= 31; day++) {
    total += 1_900_000;
    live.push(row(`2026-01-${day}`, total, 1_900_000, "live"));
  }
  const archive = [row("2025-12-22", 2_075_569_566, 1_784_077, "archive"), row("2025-12-21", 2_073_785_489, 2_044_304, "archive")];
  const desc = [...live].reverse().concat(archive);

  it("turns the first live day (no predecessor, across a 33-day gap) into a gap", () => {
    const values = dailyStreamValuesForMixedOwnHistory(desc);
    const idx = desc.findIndex((r) => r.date === "2026-01-24");
    expect(values[idx]).toBeNull();
    expect(Math.max(...values.map((v) => v ?? 0))).toBeLessThan(3_000_000);
  });

  it("keeps the 7-day average of the first days after the seam at a normal level", () => {
    const values = dailyStreamValuesForMixedOwnHistory(desc);
    const withMa = computeRollingAvg7(desc.map((r, i) => ({ date: r.date, value: values[i] })));
    for (const point of withMa) {
      if (point.ma7 != null) expect(point.ma7).toBeLessThan(3_000_000);
    }
    // 7 valid live days (25..31 Jan) are needed after the seam before an average appears.
    expect(withMa.find((p) => p.date === "2026-01-30")?.ma7).toBeNull();
    expect(withMa.find((p) => p.date === "2026-01-31")?.ma7).toBeCloseTo(1_900_000, 0);
  });

  it("never turns a gap of more than one day into a single day's value", () => {
    const gapped = [row("2026-02-05", 120, 20, "live"), row("2026-02-02", 100, 7, "live"), row("2026-02-01", 93, 6, "live")];
    expect(dailyStreamValuesForMixedOwnHistory(gapped)).toEqual([null, 7, 6]);
  });

  it("does not count null days as zero in the 7-day average", () => {
    const desc7 = Array.from({ length: 8 }, (_, i) => ({ date: `2026-03-${String(8 - i).padStart(2, "0")}`, value: i === 3 ? null : 100 }));
    const result = computeRollingAvg7(desc7);
    expect(result[0].ma7).toBeNull(); // window holds only six valid days
    expect(result[7].ma7).toBeNull();
  });

  it("does not average across missing calendar days", () => {
    const asc = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-20"];
    const desc = asc.map((date) => ({ date, value: 100 })).reverse();
    const result = computeRollingAvg7(desc);
    expect(result[0].date).toBe("2026-03-20");
    expect(result[0].ma7).toBeNull();
    expect(result[1].ma7).toBe(100);
  });
});
