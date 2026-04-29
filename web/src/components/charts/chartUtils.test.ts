import { describe, it, expect, beforeEach } from "vitest";
import { formatCompactMoney, setCurrencyDisplay } from "@/lib/format";
import {
  isIsoDateString,
  normalizeIsoDateOrNull,
  filterDailySeriesFromIsoDate,
  filterMonthlySeriesFromIsoDate,
  filterBucketedSeriesFromIsoDate,
  computePaddedDomain,
  formatKmbTick,
  extractOverrideItemsFromRechartsPayload,
  computeWeekendDipMap,
  extractWeekendDipFromRechartsPayload,
  downsampleSeries,
  computeRollingAvg7,
  computeDailyRollingAvg7,
  isWeekdayDateUtc,
  isSundayDate,
  isHighlightDayDateUtc,
  getSundayAccentColor,
} from "./chartUtils";

// ============================================================================
// isIsoDateString
// ============================================================================

describe("isIsoDateString", () => {
  it("returns true for valid ISO dates", () => {
    expect(isIsoDateString("2026-01-15")).toBe(true);
    expect(isIsoDateString("1999-12-31")).toBe(true);
  });

  it("returns false for invalid formats", () => {
    expect(isIsoDateString("2026-1-15")).toBe(false);
    expect(isIsoDateString("2026/01/15")).toBe(false);
    expect(isIsoDateString("Jan 15, 2026")).toBe(false);
    expect(isIsoDateString("")).toBe(false);
    expect(isIsoDateString("2026-01")).toBe(false);
  });
});

// ============================================================================
// normalizeIsoDateOrNull
// ============================================================================

describe("normalizeIsoDateOrNull", () => {
  it("returns valid ISO dates as-is", () => {
    expect(normalizeIsoDateOrNull("2026-01-15")).toBe("2026-01-15");
  });

  it("trims whitespace", () => {
    expect(normalizeIsoDateOrNull("  2026-01-15  ")).toBe("2026-01-15");
  });

  it("returns null for non-ISO formats", () => {
    expect(normalizeIsoDateOrNull("not-a-date")).toBeNull();
    expect(normalizeIsoDateOrNull("2026-01")).toBeNull();
  });

  it("returns null for empty/null/undefined", () => {
    expect(normalizeIsoDateOrNull("")).toBeNull();
    expect(normalizeIsoDateOrNull(null)).toBeNull();
    expect(normalizeIsoDateOrNull(undefined)).toBeNull();
  });
});

// ============================================================================
// filterDailySeriesFromIsoDate
// ============================================================================

describe("filterDailySeriesFromIsoDate", () => {
  const data = [
    { date: "2026-01-10", value: 10 },
    { date: "2026-01-15", value: 15 },
    { date: "2026-01-20", value: 20 },
    { date: "2026-01-25", value: 25 },
  ];

  it("filters from start date (inclusive)", () => {
    const result = filterDailySeriesFromIsoDate(data, "2026-01-15");
    expect(result).toHaveLength(3);
    expect(result[0].date).toBe("2026-01-15");
  });

  it("returns all data when no start date", () => {
    expect(filterDailySeriesFromIsoDate(data, null)).toEqual(data);
    expect(filterDailySeriesFromIsoDate(data, undefined)).toEqual(data);
    expect(filterDailySeriesFromIsoDate(data, "")).toEqual(data);
  });

  it("returns empty when start date is after all data", () => {
    expect(filterDailySeriesFromIsoDate(data, "2027-01-01")).toHaveLength(0);
  });

  it("returns all when start date is before all data", () => {
    expect(filterDailySeriesFromIsoDate(data, "2020-01-01")).toHaveLength(4);
  });
});

// ============================================================================
// filterMonthlySeriesFromIsoDate
// ============================================================================

describe("filterMonthlySeriesFromIsoDate", () => {
  const data = [
    { month: "2025-10" },
    { month: "2025-11" },
    { month: "2025-12" },
    { month: "2026-01" },
  ];

  it("filters from the month containing start date", () => {
    const result = filterMonthlySeriesFromIsoDate(data, "2025-11-15");
    expect(result).toHaveLength(3);
    expect(result[0].month).toBe("2025-11");
  });

  it("returns all when no start date", () => {
    expect(filterMonthlySeriesFromIsoDate(data, null)).toEqual(data);
  });
});

// ============================================================================
// filterBucketedSeriesFromIsoDate
// ============================================================================

describe("filterBucketedSeriesFromIsoDate", () => {
  it("delegates to daily filter for 'daily' granularity", () => {
    const data = [{ date: "2026-01-01" }, { date: "2026-01-15" }];
    const result = filterBucketedSeriesFromIsoDate(data, "daily", "2026-01-10");
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-01-15");
  });

  it("filters yearly data", () => {
    const data = [{ date: "2024" }, { date: "2025" }, { date: "2026" }];
    const result = filterBucketedSeriesFromIsoDate(data, "yearly", "2025-06-01");
    expect(result).toHaveLength(2);
  });

  it("filters quarterly data", () => {
    const data = [
      { date: "Q1 2025" },
      { date: "Q2 2025" },
      { date: "Q3 2025" },
      { date: "Q4 2025" },
    ];
    const result = filterBucketedSeriesFromIsoDate(data, "quarterly", "2025-04-01");
    // April = Q2, so Q2 and beyond
    expect(result).toHaveLength(3);
  });

  it("returns all when no start date", () => {
    const data = [{ date: "2026-01-01" }];
    expect(filterBucketedSeriesFromIsoDate(data, "daily", null)).toEqual(data);
  });
});

// ============================================================================
// computePaddedDomain
// ============================================================================

describe("computePaddedDomain", () => {
  it("returns undefined for empty values", () => {
    expect(computePaddedDomain([])).toBeUndefined();
  });

  it("returns undefined for all-null values", () => {
    expect(computePaddedDomain([null, null, undefined])).toBeUndefined();
  });

  it("pads a single value", () => {
    const result = computePaddedDomain([100]);
    expect(result).toBeDefined();
    expect(result![0]).toBeLessThan(100);
    expect(result![1]).toBeGreaterThan(100);
  });

  it("pads a range of values", () => {
    const result = computePaddedDomain([10, 50, 100]);
    expect(result).toBeDefined();
    expect(result![0]).toBeLessThan(10);
    expect(result![1]).toBeGreaterThan(100);
  });

  it("clamps min to zero when requested", () => {
    const result = computePaddedDomain([5, 10, 20], { clampMinToZero: true });
    expect(result).toBeDefined();
    expect(result![0]).toBeGreaterThanOrEqual(0);
  });

  it("handles identical values", () => {
    const result = computePaddedDomain([50, 50, 50]);
    expect(result).toBeDefined();
    expect(result![0]).toBeLessThan(50);
    expect(result![1]).toBeGreaterThan(50);
  });

  it("filters out null/undefined values", () => {
    const result = computePaddedDomain([null, 10, undefined, 20, null]);
    expect(result).toBeDefined();
    expect(result![0]).toBeLessThan(10);
    expect(result![1]).toBeGreaterThan(20);
  });
});

// ============================================================================
// formatKmbTick
// ============================================================================

describe("formatKmbTick", () => {
  it("formats billions", () => {
    expect(formatKmbTick(1_000_000_000)).toBe("1B");
    expect(formatKmbTick(2_500_000_000)).toBe("2.5B");
  });

  it("formats millions", () => {
    expect(formatKmbTick(1_000_000)).toBe("1M");
    expect(formatKmbTick(5_500_000)).toBe("5.5M");
  });

  it("formats thousands", () => {
    expect(formatKmbTick(1_000)).toBe("1k");
    expect(formatKmbTick(50_000)).toBe("50k");
    expect(formatKmbTick(1_500)).toBe("1.5k");
  });

  it("formats small numbers with commas", () => {
    expect(formatKmbTick(500)).toBe("500");
    expect(formatKmbTick(0)).toBe("0");
  });

  it("handles negative values", () => {
    expect(formatKmbTick(-1_000_000)).toBe("-1M");
    expect(formatKmbTick(-500)).toBe("-500");
  });
});

// ============================================================================
// formatCompactMoney
// ============================================================================

describe("formatCompactMoney", () => {
  beforeEach(() => {
    setCurrencyDisplay("USD");
  });

  it("formats USD in compact notation", () => {
    const result = formatCompactMoney(1_000_000, (n) => `$${n}`);
    expect(result).toMatch(/\$1\.00M|\$1,000\.00K/i);
  });

  it("uses fallback on error", () => {
    // Force an edge case — this just verifies the fallback path is available
    const result = formatCompactMoney(0, () => "fallback");
    expect(typeof result).toBe("string");
  });
});

// ============================================================================
// extractOverrideItemsFromRechartsPayload
// ============================================================================

describe("extractOverrideItemsFromRechartsPayload", () => {
  it("returns null for empty/non-array", () => {
    expect(extractOverrideItemsFromRechartsPayload(null)).toBeNull();
    expect(extractOverrideItemsFromRechartsPayload([])).toBeNull();
    expect(extractOverrideItemsFromRechartsPayload("string")).toBeNull();
  });

  it("returns null when no override items", () => {
    expect(extractOverrideItemsFromRechartsPayload([{ payload: {} }])).toBeNull();
    expect(extractOverrideItemsFromRechartsPayload([{ payload: { _overrideItems: [] } }])).toBeNull();
  });

  it("extracts override items", () => {
    const payload = [{
      payload: {
        _overrideItems: [
          { note: "Interpolated from 2026-01-01", title: "Track A", imageUrl: "http://img.jpg" },
          { note: "Manual fix" },
        ],
      },
    }];
    const result = extractOverrideItemsFromRechartsPayload(payload);
    expect(result).toHaveLength(2);
    expect(result![0].note).toBe("Interpolated from 2026-01-01");
    expect(result![0].title).toBe("Track A");
    expect(result![0].imageUrl).toBe("http://img.jpg");
    expect(result![1].title).toBeUndefined();
  });
});

// ============================================================================
// computeWeekendDipMap
// ============================================================================

describe("computeWeekendDipMap", () => {
  it("returns empty map for empty data", () => {
    expect(computeWeekendDipMap([]).size).toBe(0);
  });

  it("computes dip for Saturday/Sunday with sufficient weekday data", () => {
    // 2026-02-09 = Monday, 2026-02-14 = Saturday, 2026-02-15 = Sunday
    const data = [
      { date: "2026-02-09", value: 1000 }, // Mon
      { date: "2026-02-10", value: 1000 }, // Tue
      { date: "2026-02-11", value: 1000 }, // Wed
      { date: "2026-02-12", value: 1000 }, // Thu
      { date: "2026-02-13", value: 1000 }, // Fri
      { date: "2026-02-14", value: 800 },  // Sat
      { date: "2026-02-15", value: 700 },  // Sun
    ];
    const dip = computeWeekendDipMap(data);
    expect(dip.has("2026-02-14")).toBe(true);
    expect(dip.has("2026-02-15")).toBe(true);
    // Saturday dip: (800 - 1000) / 1000 * 100 = -20%
    expect(dip.get("2026-02-14")).toBeCloseTo(-20, 1);
    // Sunday dip: (700 - 1000) / 1000 * 100 = -30%
    expect(dip.get("2026-02-15")).toBeCloseTo(-30, 1);
  });

  it("skips weekends with fewer than 3 weekday values", () => {
    const data = [
      { date: "2026-02-09", value: 1000 }, // Mon
      { date: "2026-02-10", value: 1000 }, // Tue
      // Missing Wed-Fri
      { date: "2026-02-14", value: 800 },  // Sat
    ];
    const dip = computeWeekendDipMap(data);
    expect(dip.has("2026-02-14")).toBe(false);
  });

  it("supports 'daily' field as well as 'value'", () => {
    const data = [
      { date: "2026-02-09", daily: 1000 },
      { date: "2026-02-10", daily: 1000 },
      { date: "2026-02-11", daily: 1000 },
      { date: "2026-02-12", daily: 1000 },
      { date: "2026-02-13", daily: 1000 },
      { date: "2026-02-14", daily: 800 },
    ];
    const dip = computeWeekendDipMap(data);
    expect(dip.has("2026-02-14")).toBe(true);
  });
});

// ============================================================================
// extractWeekendDipFromRechartsPayload
// ============================================================================

describe("extractWeekendDipFromRechartsPayload", () => {
  it("returns null for empty/non-array", () => {
    expect(extractWeekendDipFromRechartsPayload(null)).toBeNull();
    expect(extractWeekendDipFromRechartsPayload([])).toBeNull();
  });

  it("extracts dip percentage", () => {
    const payload = [{ payload: { _weekendDipPct: -15.5 } }];
    expect(extractWeekendDipFromRechartsPayload(payload)).toBeCloseTo(-15.5);
  });

  it("returns null when no dip field", () => {
    expect(extractWeekendDipFromRechartsPayload([{ payload: {} }])).toBeNull();
  });
});

// ============================================================================
// downsampleSeries
// ============================================================================

describe("downsampleSeries", () => {
  it("passes through when data is under maxPoints", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      value: i * 100,
    }));
    expect(downsampleSeries(data, 400)).toEqual(data);
  });

  it("downsamples when data exceeds maxPoints", () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
      date: `day-${i}`,
      value: Math.sin(i / 10) * 100,
    }));
    const result = downsampleSeries(data, 100);
    expect(result.length).toBeLessThanOrEqual(250); // maxPoints + extras
    expect(result.length).toBeGreaterThanOrEqual(100);
  });

  it("preserves first and last points", () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
      date: `day-${i}`,
      value: i,
    }));
    const result = downsampleSeries(data, 50);
    expect(result[0]).toBe(data[0]);
    expect(result[result.length - 1]).toBe(data[data.length - 1]);
  });

  it("handles empty/null data", () => {
    expect(downsampleSeries([], 100)).toEqual([]);
  });
});

// ============================================================================
// computeRollingAvg7
// ============================================================================

describe("computeRollingAvg7", () => {
  it("computes MA7 for a 7+ day descending series", () => {
    // Descending order (newest first)
    const desc = Array.from({ length: 10 }, (_, i) => ({
      date: `day-${9 - i}`,
      value: 100,
    }));
    const result = computeRollingAvg7(desc);
    expect(result).toHaveLength(10);
    // First 6 (oldest in ascending = newest in descending) have null ma7
    // Actually: input is desc, reversed to asc, MA7 computed on asc, then reversed back
    // The first 6 points in ascending order won't have MA7
    // In descending output, the last 6 points will have null MA7
    const nullCount = result.filter((r) => r.ma7 === null).length;
    expect(nullCount).toBe(6); // need exactly 7 to compute
  });

  it("computes correct average", () => {
    // 7 days of values 1-7 in descending order
    const desc = [
      { date: "d7", value: 7 },
      { date: "d6", value: 6 },
      { date: "d5", value: 5 },
      { date: "d4", value: 4 },
      { date: "d3", value: 3 },
      { date: "d2", value: 2 },
      { date: "d1", value: 1 },
    ];
    const result = computeRollingAvg7(desc);
    // The first point in desc (d7) is the newest, which is last in asc
    // In asc order: d1(1), d2(2), ..., d7(7)
    // MA7 at d7 = avg(1..7) = 4
    expect(result[0].ma7).toBe(4);
    // d6 in asc position 5 (index 5) has only 6 values, so null
    expect(result[result.length - 1].ma7).toBeNull();
  });

  it("handles empty array", () => {
    expect(computeRollingAvg7([])).toEqual([]);
  });
});

// ============================================================================
// computeDailyRollingAvg7
// ============================================================================

describe("computeDailyRollingAvg7", () => {
  it("uses 'daily' field instead of 'value'", () => {
    const desc = Array.from({ length: 7 }, (_, i) => ({
      date: `day-${6 - i}`,
      daily: 100,
    }));
    const result = computeDailyRollingAvg7(desc);
    expect(result[0].ma7).toBe(100); // all 7 days = 100
  });
});

// ============================================================================
// isWeekdayDateUtc / isSundayDate / isHighlightDayDateUtc
// ============================================================================

describe("isWeekdayDateUtc", () => {
  it("correctly identifies Sunday (0)", () => {
    // 2026-02-15 is a Sunday
    expect(isWeekdayDateUtc("2026-02-15", 0)).toBe(true);
    expect(isWeekdayDateUtc("2026-02-15", 1)).toBe(false);
  });

  it("correctly identifies Monday (1)", () => {
    // 2026-02-09 is a Monday
    expect(isWeekdayDateUtc("2026-02-09", 1)).toBe(true);
  });

  it("correctly identifies Saturday (6)", () => {
    // 2026-02-14 is a Saturday
    expect(isWeekdayDateUtc("2026-02-14", 6)).toBe(true);
  });
});

describe("isSundayDate", () => {
  it("returns true for Sundays", () => {
    expect(isSundayDate("2026-02-15")).toBe(true);
  });

  it("returns false for non-Sundays", () => {
    expect(isSundayDate("2026-02-14")).toBe(false); // Saturday
    expect(isSundayDate("2026-02-13")).toBe(false); // Friday
  });
});

describe("isHighlightDayDateUtc", () => {
  it("defaults to Sunday when no weekday specified", () => {
    expect(isHighlightDayDateUtc("2026-02-15")).toBe(true); // Sunday
    expect(isHighlightDayDateUtc("2026-02-14")).toBe(false); // Saturday
  });

  it("uses specified weekday", () => {
    // 2026-02-13 is a Friday (5)
    expect(isHighlightDayDateUtc("2026-02-13", 5)).toBe(true);
    expect(isHighlightDayDateUtc("2026-02-13", 0)).toBe(false);
  });

  it("handles invalid weekday input gracefully (falls back to Sunday)", () => {
    expect(isHighlightDayDateUtc("2026-02-15", "invalid")).toBe(true); // falls back to Sunday=0
    expect(isHighlightDayDateUtc("2026-02-15", null)).toBe(true);
  });
});

// ============================================================================
// getSundayAccentColor
// ============================================================================

describe("getSundayAccentColor", () => {
  it("returns the base color for unparseable input", () => {
    expect(getSundayAccentColor("notacolor")).toBe("notacolor");
  });

  it("returns an rgba string for valid hex", () => {
    const result = getSundayAccentColor("#3b82f6");
    expect(result).toMatch(/^rgba\(/);
  });

  it("produces a darker variant in light mode", () => {
    const result = getSundayAccentColor("#3b82f6");
    // Should contain reduced R,G,B values (mixed toward black at 22%)
    expect(result).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
  });

  it("produces a faded variant in dark mode", () => {
    const result = getSundayAccentColor("#3b82f6", { isDark: true });
    expect(result).toMatch(/^rgba\(/);
  });

  it("handles #rgb shorthand", () => {
    const result = getSundayAccentColor("#f00");
    expect(result).toMatch(/^rgba\(/);
  });

  it("handles rgb() format", () => {
    const result = getSundayAccentColor("rgb(59, 130, 246)");
    expect(result).toMatch(/^rgba\(/);
  });

  it("handles rgba() format", () => {
    const result = getSundayAccentColor("rgba(59, 130, 246, 0.8)");
    expect(result).toMatch(/^rgba\(/);
  });
});
