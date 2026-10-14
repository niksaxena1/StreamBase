import { describe, expect, it } from "vitest";

import {
  FIRST_LIVE_RUN_DATE_ISO,
  FIRST_LIVE_SNAPSHOT_DATE_ISO,
  addDaysIso,
  aggregateSeries,
  archivedShadeKeys,
  axisShowsYear,
  bucketCalendarDays,
  bucketEndIso,
  bucketStartIso,
  buildAdaptiveSeries,
  buildDailyExportRows,
  formatAdaptiveTick,
  formatAdaptiveTooltipDate,
  formatWindowLabel,
  goToDateWindow,
  isArchivedDate,
  rangeDaysNeededFor,
  selectGranularity,
  spanDays,
  weekdayOf,
  windowForBucket,
  windowForBucketKeys,
} from "./aggregateSeries";

function days(start: string, count: number, valueOf: (index: number, date: string) => number | null) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDaysIso(start, i);
    return { date, value: valueOf(i, date) };
  });
}

describe("date arithmetic", () => {
  it("counts inclusive spans and weekdays in UTC", () => {
    expect(spanDays("2024-03-01", "2024-03-01")).toBe(1);
    expect(spanDays("2024-02-01", "2024-03-01")).toBe(30);
    expect(weekdayOf("2024-03-14")).toBe(4); // Thursday
    expect(addDaysIso("2024-02-28", 2)).toBe("2024-03-01"); // leap year
  });

  it("finds ISO-week Mondays, including across year boundaries", () => {
    expect(bucketStartIso("2024-03-04", "weekly")).toBe("2024-03-04"); // Monday
    expect(bucketStartIso("2024-03-10", "weekly")).toBe("2024-03-04"); // Sunday belongs to the previous Monday
    expect(bucketStartIso("2024-03-11", "weekly")).toBe("2024-03-11");
    expect(bucketStartIso("2023-01-01", "weekly")).toBe("2022-12-26"); // Sunday
    expect(bucketStartIso("2023-07-08", "weekly")).toBe("2023-07-03"); // first day of history is a Saturday
    expect(bucketEndIso("2024-03-04", "weekly")).toBe("2024-03-10");
  });

  it("finds month buckets, including leap February", () => {
    expect(bucketStartIso("2024-02-17", "monthly")).toBe("2024-02-01");
    expect(bucketEndIso("2024-02-01", "monthly")).toBe("2024-02-29");
    expect(bucketEndIso("2023-02-01", "monthly")).toBe("2023-02-28");
    expect(bucketCalendarDays("2024-04-01", "monthly")).toBe(30);
    expect(bucketCalendarDays("2024-03-04", "weekly")).toBe(7);
    expect(bucketStartIso("2024-03-14", "daily")).toBe("2024-03-14");
  });
});

describe("selectGranularity", () => {
  it("follows the visible span in auto mode", () => {
    expect(selectGranularity(1)).toBe("daily");
    expect(selectGranularity(30)).toBe("daily");
    expect(selectGranularity(186)).toBe("daily");
    expect(selectGranularity(187)).toBe("weekly");
    expect(selectGranularity(366)).toBe("weekly");
    expect(selectGranularity(730)).toBe("weekly");
    expect(selectGranularity(731)).toBe("monthly");
    expect(selectGranularity(1300)).toBe("monthly");
  });

  it("honours an explicit choice", () => {
    expect(selectGranularity(1300, "daily")).toBe("daily");
    expect(selectGranularity(10, "weekly")).toBe("weekly");
    expect(selectGranularity(10, "monthly")).toBe("monthly");
  });
});

describe("aggregateSeries (average per covered day)", () => {
  it("averages over days that have data and reports the bucket total and coverage", () => {
    // 2024-03-04 (Mon) .. 2024-03-10 (Sun): full week of 100..700
    const week = days("2024-03-04", 7, (i) => (i + 1) * 100);
    const [bucket] = aggregateSeries(week, "weekly", "average");
    expect(bucket).toMatchObject({
      date: "2024-03-04",
      endDate: "2024-03-10",
      value: 400,
      total: 2800,
      coverageDays: 7,
      calendarDays: 7,
      partial: false,
    });
  });

  it("never counts null days as zero", () => {
    const week = days("2024-03-04", 7, (i) => (i % 2 === 0 ? 100 : null)); // 4 covered days of 100
    const [bucket] = aggregateSeries(week, "weekly", "average");
    expect(bucket.value).toBe(100);
    expect(bucket.total).toBe(400);
    expect(bucket.coverageDays).toBe(4);
    expect(bucket.partial).toBe(true);
  });

  it("marks the unfinished current week and an early-loaded first week as partial", () => {
    const series = days("2024-03-06", 7, () => 50); // Wed .. Tue
    const buckets = aggregateSeries(series, "weekly", "average");
    expect(buckets.map((b) => [b.date, b.coverageDays, b.partial])).toEqual([
      ["2024-03-04", 5, true],
      ["2024-03-11", 2, true],
    ]);
  });

  it("emits empty buckets for gaps so the line breaks instead of bridging", () => {
    const series = [...days("2024-03-04", 7, () => 10), ...days("2024-03-25", 7, () => 30)];
    const buckets = aggregateSeries(series, "weekly", "average");
    expect(buckets.map((b) => b.date)).toEqual(["2024-03-04", "2024-03-11", "2024-03-18", "2024-03-25"]);
    expect(buckets[1].value).toBeNull();
    expect(buckets[1].total).toBeNull();
    expect(buckets[1].coverageDays).toBe(0);
    expect(buckets[2].value).toBeNull();
    expect(buckets[3].value).toBe(30);
  });

  it("uses real month lengths for coverage", () => {
    const feb = days("2024-02-01", 29, () => 10);
    const [bucket] = aggregateSeries(feb, "monthly", "average");
    expect(bucket.calendarDays).toBe(29);
    expect(bucket.partial).toBe(false);
    const [short] = aggregateSeries(days("2024-02-01", 12, () => 10), "monthly", "average");
    expect(short).toMatchObject({ coverageDays: 12, calendarDays: 29, partial: true, total: 120, value: 10 });
  });

  it("buckets weeks that span a month end into one weekly bucket", () => {
    const series = days("2024-02-26", 7, () => 70); // Mon 26 Feb .. Sun 3 Mar
    const weekly = aggregateSeries(series, "weekly", "average");
    expect(weekly).toHaveLength(1);
    const monthly = aggregateSeries(series, "monthly", "average");
    expect(monthly.map((b) => [b.date, b.coverageDays])).toEqual([["2024-02-01", 4], ["2024-03-01", 3]]);
  });

  it("restricts output to a range but still averages whole buckets", () => {
    const series = days("2024-03-01", 31, (i) => i + 1);
    const buckets = aggregateSeries(series, "weekly", "average", { start: "2024-03-11", end: "2024-03-17" });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ date: "2024-03-11", coverageDays: 7, value: 14 });
  });

  it("returns nothing for empty or non-ISO input", () => {
    expect(aggregateSeries([], "weekly", "average")).toEqual([]);
    expect(aggregateSeries([{ date: "2024-W10", value: 1 }], "weekly", "average")).toEqual([]);
  });
});

describe("aggregateSeries (cumulative last value)", () => {
  it("takes the last covered value per bucket", () => {
    const series = days("2024-03-04", 14, (i) => 1000 + i * 10);
    const buckets = aggregateSeries(series, "weekly", "last");
    expect(buckets.map((b) => b.value)).toEqual([1060, 1130]);
    expect(buckets.every((b) => b.total === null)).toBe(true);
  });

  it("ignores trailing nulls and leaves fully empty buckets null", () => {
    const series = [
      { date: "2024-03-04", value: 5 },
      { date: "2024-03-05", value: 9 },
      { date: "2024-03-06", value: null },
      { date: "2024-03-18", value: 20 },
    ];
    const buckets = aggregateSeries(series, "weekly", "last");
    expect(buckets.map((b) => b.value)).toEqual([9, null, 20]);
  });
});

describe("buildAdaptiveSeries", () => {
  const desc = (rows: Array<{ date: string; value: number | null; ma7?: number | null }>) => [...rows].reverse();

  it("passes daily rows through for a short span and flags archived days", () => {
    const rows = desc(days("2026-01-20", 10, (i) => i));
    const result = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: false,
      window: null,
      mode: "auto",
      firstLiveIso: "2026-01-24",
    });
    expect(result.granularity).toBe("daily");
    expect(result.forcedDaily).toBe(false);
    expect(result.rowsDesc).toHaveLength(10);
    expect(result.rowsDesc[0].date).toBe("2026-01-29"); // newest first
    const archived = result.rowsDesc.filter((r) => r._archived).map((r) => r.date).sort();
    expect(archived).toEqual(["2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23"]);
  });

  it("switches to weekly averages for a long span and keeps newest-first order", () => {
    const rows = desc(days("2024-01-01", 300, () => 100));
    const result = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: false,
      window: null,
      mode: "auto",
    });
    expect(result.granularity).toBe("weekly");
    expect(result.rowsDesc[0].date > result.rowsDesc[1].date).toBe(true);
    expect(result.rowsDesc.every((r) => r.value === 100 || r.value === null)).toBe(true);
    expect(result.rowsDesc[result.rowsDesc.length - 1].date).toBe("2024-01-01");
    expect(result.rowsDesc[0]._isAverage).toBe(true);
  });

  it("re-evaluates granularity after zooming into a window", () => {
    const rows = desc(days("2023-07-08", 1000, (i) => i));
    const all = buildAdaptiveSeries({ rowsDesc: rows, valueKey: "value", isCumulative: false, window: null, mode: "auto" });
    expect(all.granularity).toBe("monthly");
    const zoomed = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: false,
      window: { start: "2024-03-01", end: "2024-03-31" },
      mode: "auto",
    });
    expect(zoomed.granularity).toBe("daily");
    expect(zoomed.rowsDesc).toHaveLength(31);
    expect(zoomed.spanDays).toBe(31);
  });

  it("flags a forced daily view over the daily limit", () => {
    const rows = desc(days("2024-01-01", 400, () => 1));
    const forced = buildAdaptiveSeries({ rowsDesc: rows, valueKey: "value", isCumulative: false, window: null, mode: "daily" });
    expect(forced.granularity).toBe("daily");
    expect(forced.forcedDaily).toBe(true);
    expect(forced.rowsDesc).toHaveLength(400);
    const short = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: false,
      window: { start: "2024-01-01", end: "2024-02-01" },
      mode: "daily",
    });
    expect(short.forcedDaily).toBe(false);
  });

  it("aggregates the cumulative chart with last values and the gap stays null for daily totals", () => {
    const cumulative = desc(days("2025-12-15", 8, (i) => 100 + i)); // up to 22 Dec, then the gap
    const after = desc(days("2026-01-24", 8, (i) => 200 + i));
    const rows = [...after, ...cumulative];
    const total = buildAdaptiveSeries({ rowsDesc: rows, valueKey: "value", isCumulative: true, window: null, mode: "weekly" });
    const gapBuckets = total.rowsDesc.filter((r) => r._coverageDays === 0);
    expect(gapBuckets.length).toBeGreaterThan(0);
    expect(gapBuckets.every((r) => r.value === null)).toBe(true);
    const daily = buildAdaptiveSeries({ rowsDesc: rows, valueKey: "value", isCumulative: false, window: null, mode: "monthly" });
    expect(daily.rowsDesc.map((r) => r.date)).toEqual(["2026-01-01", "2025-12-01"]);
    expect(daily.rowsDesc[1]._coverageDays).toBe(8);
    expect(daily.rowsDesc[1]._partialBucket).toBe(true);
  });

  it("marks buckets as archived or straddling the first live day", () => {
    const rows = desc(days("2026-01-05", 40, () => 10));
    const weekly = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: false,
      window: null,
      mode: "weekly",
      firstLiveIso: "2026-01-24",
    });
    const byDate = new Map(weekly.rowsDesc.map((r) => [r.date, r]));
    expect(byDate.get("2026-01-05")?._archived).toBe(true);
    expect(byDate.get("2026-01-19")?._archived).toBe(false);
    expect(byDate.get("2026-01-19")?._straddlesArchive).toBe(true); // 19..25 Jan contains the 24th
    expect(byDate.get("2026-01-26")?._archived).toBe(false);
    expect(byDate.get("2026-01-26")?._straddlesArchive).toBe(false);
  });

  it("bypasses the adaptive layer for pre-bucketed (page-level weekly) input", () => {
    const rows = [{ date: "2024-W11", value: 5 }, { date: "2024-W10", value: 4 }];
    const result = buildAdaptiveSeries({ rowsDesc: rows, valueKey: "value", isCumulative: false, window: null, mode: "auto" });
    expect(result.preBucketed).toBe(true);
    expect(result.rowsDesc).toBe(rows);
  });
});

describe("buildAdaptiveSeries daily gap filling", () => {
  it("inserts null rows for missing calendar days so gaps are drawn as gaps", () => {
    const rows = [
      { date: "2026-01-26", value: 3 },
      { date: "2026-01-25", value: 2 },
      { date: "2025-12-22", value: 1 },
    ];
    const result = buildAdaptiveSeries({
      rowsDesc: rows,
      valueKey: "value",
      isCumulative: true,
      window: null,
      mode: "daily",
      firstLiveIso: "2026-01-24",
    });
    expect(result.rowsDesc).toHaveLength(36);
    expect(result.rowsDesc[0].date).toBe("2026-01-26");
    const gap = result.rowsDesc.filter((r) => r.value === null);
    expect(gap).toHaveLength(33);
    expect(gap.every((r) => r._archived === (r.date < "2026-01-24"))).toBe(true);
  });
});

describe("zoom helpers", () => {
  const bounds = { start: "2023-07-08", end: "2026-10-12" };

  it("maps a drag across buckets to the covered days", () => {
    expect(windowForBucketKeys("2024-03-18", "2024-03-04", "weekly", bounds)).toEqual({ start: "2024-03-04", end: "2024-03-24" });
    expect(windowForBucketKeys("2024-01-01", "2024-03-01", "monthly", bounds)).toEqual({ start: "2024-01-01", end: "2024-03-31" });
  });

  it("drills into a single bucket and clamps to the loaded data", () => {
    expect(windowForBucket("2024-03-01", "monthly", bounds)).toEqual({ start: "2024-03-01", end: "2024-03-31" });
    expect(windowForBucket("2023-07-03", "weekly", bounds)).toEqual({ start: "2023-07-08", end: "2023-07-09" });
  });

  it("builds a go-to-date window of +/- 30 days", () => {
    expect(goToDateWindow("2024-03-14", bounds)).toEqual({ start: "2024-02-13", end: "2024-04-13" });
    expect(goToDateWindow("2023-07-10", bounds)).toEqual({ start: "2023-07-08", end: "2023-08-09" });
  });

  it("computes the range a go-to-date needs from the server", () => {
    expect(rangeDaysNeededFor("2026-10-12", "2026-09-01", 1300)).toBe(71);
    expect(rangeDaysNeededFor("2026-10-12", "2023-07-08", 1300)).toBe(1222);
    expect(rangeDaysNeededFor("2026-10-12", "2023-07-08", 1000)).toBe(1000);
  });
});

describe("date formatting", () => {
  const short = { start: "2024-02-01", end: "2024-03-01" };

  it("only adds the year when the span crosses a year or exceeds about ten months", () => {
    expect(axisShowsYear(short)).toBe(false);
    expect(axisShowsYear({ start: "2024-01-01", end: "2024-10-30" })).toBe(false); // 304 days
    expect(axisShowsYear({ start: "2024-01-01", end: "2024-10-31" })).toBe(true); // 305 days
    expect(axisShowsYear({ start: "2024-12-20", end: "2025-01-10" })).toBe(true);
    expect(axisShowsYear(null)).toBe(false);
  });

  it("formats daily, year-bearing, multi-year and monthly ticks", () => {
    expect(formatAdaptiveTick("2024-02-12", "daily", short)).toBe("12 Feb");
    expect(formatAdaptiveTick("2024-12-30", "daily", { start: "2024-12-20", end: "2025-01-10" })).toBe("30 Dec '24");
    expect(formatAdaptiveTick("2024-02-05", "weekly", { start: "2023-09-01", end: "2024-09-01" })).toBe("5 Feb '24");
    expect(formatAdaptiveTick("2024-02-01", "weekly", { start: "2023-01-01", end: "2025-06-01" })).toBe("Feb '24");
    expect(formatAdaptiveTick("2024-03-01", "monthly", { start: "2023-07-08", end: "2026-10-12" })).toBe("Mar 2024");
    expect(formatAdaptiveTick("2024-03-01", "monthly", short)).toBe("Mar 2024");
  });

  it("leaves non-ISO keys alone", () => {
    expect(formatAdaptiveTick("2024-W10", "weekly", short)).toBe("2024-W10");
    expect(formatAdaptiveTooltipDate("Q1 2024")).toBe("Q1 2024");
  });

  it("always includes weekday and year in tooltips", () => {
    expect(formatAdaptiveTooltipDate("2024-03-14", "daily")).toBe("Thu 14 Mar 2024");
    expect(formatAdaptiveTooltipDate("2024-03-04", "weekly")).toBe("Week of 4 Mar 2024");
    expect(formatAdaptiveTooltipDate("2024-03-01", "monthly")).toBe("March 2024");
  });

  it("labels breadcrumb windows", () => {
    expect(formatWindowLabel({ start: "2024-03-01", end: "2024-03-31" }, "monthly")).toBe("Mar 2024");
    expect(formatWindowLabel({ start: "2024-03-04", end: "2024-03-10" }, "weekly")).toBe("Week of 4 Mar 2024");
    expect(formatWindowLabel({ start: "2024-03-04", end: "2024-04-02" })).toBe("4 Mar – 2 Apr 2024");
    expect(formatWindowLabel({ start: "2023-12-20", end: "2024-01-05" })).toBe("20 Dec 2023 – 5 Jan 2024");
  });
});

describe("archived boundary", () => {
  it("defaults to the first live snapshot date", () => {
    // Live snapshots start on run date 2026-01-24; charts use data dates (run date minus the 2-day lag).
    expect(FIRST_LIVE_RUN_DATE_ISO).toBe("2026-01-24");
    expect(FIRST_LIVE_SNAPSHOT_DATE_ISO).toBe("2026-01-22");
    expect(isArchivedDate("2026-01-21")).toBe(true);
    expect(isArchivedDate("2026-01-22")).toBe(false);
    expect(isArchivedDate("2026-01-23", "2026-02-01")).toBe(true);
    expect(isArchivedDate("2026-01-31", "2026-02-01")).toBe(true);
    expect(isArchivedDate("2026-02-01", "2026-02-01")).toBe(false);
  });

  it("picks the shaded keys among visible x values", () => {
    const keys = ["2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"];
    expect(archivedShadeKeys(keys, "2026-01-24")).toEqual({ x1: "2026-01-12", x2: "2026-01-19" });
    expect(archivedShadeKeys(keys, "2026-01-01")).toBeNull();
    expect(archivedShadeKeys(keys, "2026-03-01")).toEqual({ x1: "2026-01-12", x2: "2026-02-02" });
    expect(archivedShadeKeys([], "2026-01-24")).toBeNull();
  });
});

describe("buildDailyExportRows", () => {
  it("exports the visible window as daily rows with the archived flag", () => {
    const daily = days("2026-01-20", 8, (i) => 10 + i);
    const total = days("2026-01-20", 8, (i) => 1000 + i * 10);
    const rows = buildDailyExportRows({
      dailyRows: daily,
      dailyKey: "value",
      totalRows: total,
      totalKey: "value",
      window: { start: "2026-01-22", end: "2026-01-25" },
      firstLiveIso: "2026-01-24",
    });
    expect(rows).toEqual([
      { date: "2026-01-22", total: 1020, daily: 12, archived: true },
      { date: "2026-01-23", total: 1030, daily: 13, archived: true },
      { date: "2026-01-24", total: 1040, daily: 14, archived: false },
      { date: "2026-01-25", total: 1050, daily: 15, archived: false },
    ]);
  });

  it("exports everything when nothing is zoomed and keeps gaps as null", () => {
    const rows = buildDailyExportRows({
      dailyRows: [{ date: "2026-02-01", daily: null }, { date: "2026-02-02", daily: 5 }],
      dailyKey: "daily",
      totalRows: [{ date: "2026-02-02", value: 99 }],
      totalKey: "value",
      window: null,
    });
    expect(rows).toEqual([
      { date: "2026-02-01", total: null, daily: null, archived: false },
      { date: "2026-02-02", total: 99, daily: 5, archived: false },
    ]);
  });
});
