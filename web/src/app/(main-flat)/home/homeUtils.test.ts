import { describe, it, expect, beforeEach } from "vitest";
import { setCurrencyDisplay } from "@/lib/format";
import {
  parseMilestonesText,
  parseDailyBucketsText,
  formatMilestoneForInput,
  formatMilestoneHeaderLabel,
  rollSum,
} from "./homeUtils";

// ============================================================================
// parseMilestonesText
// ============================================================================

describe("parseMilestonesText", () => {
  const streamArgs = { mode: "streams" as const, payoutPerStreamUsd: 0.003 };
  const revenueArgs = { mode: "revenue" as const, payoutPerStreamUsd: 0.003 };

  it("parses simple stream milestones", () => {
    const result = parseMilestonesText("1M, 5M, 10M", streamArgs);
    expect(result.error).toBeNull();
    expect(result.milestones).toEqual([10_000_000, 5_000_000, 1_000_000]);
  });

  it("parses K/M/B suffixes", () => {
    const result = parseMilestonesText("100k 500k 1m", streamArgs);
    expect(result.error).toBeNull();
    expect(result.milestones).toEqual([1_000_000, 500_000, 100_000]);
  });

  it("deduplicates and sorts descending", () => {
    const result = parseMilestonesText("1M 1M 500k", streamArgs);
    expect(result.milestones).toEqual([1_000_000, 500_000]);
  });

  it("returns empty for empty input", () => {
    const result = parseMilestonesText("", streamArgs);
    expect(result.milestones).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("rejects milestones below 100K", () => {
    const result = parseMilestonesText("50k", streamArgs);
    expect(result.error).toContain("100K");
    expect(result.milestones).toEqual([]);
  });

  it("rejects invalid input", () => {
    const result = parseMilestonesText("abc", streamArgs);
    expect(result.error).toContain("Invalid milestone");
  });

  it("handles revenue mode with $ prefix", () => {
    // $3000 / 0.003 per stream = 1,000,000 streams
    const result = parseMilestonesText("$3000", revenueArgs);
    expect(result.error).toBeNull();
    expect(result.milestones).toEqual([1_000_000]);
  });

  it("rejects revenue milestones with zero payout rate", () => {
    const result = parseMilestonesText("$1000", { mode: "revenue", payoutPerStreamUsd: 0 });
    expect(result.error).toContain("payout rate");
  });

  it("handles underscores and commas in numbers", () => {
    const result = parseMilestonesText("1_000_000", streamArgs);
    expect(result.error).toBeNull();
    expect(result.milestones).toEqual([1_000_000]);
  });
});

// ============================================================================
// parseDailyBucketsText
// ============================================================================

describe("parseDailyBucketsText", () => {
  it("parses simple ranges", () => {
    const result = parseDailyBucketsText("0-100 100-500 500+");
    expect(result.error).toBeNull();
    expect(result.buckets).toHaveLength(3);
    expect(result.buckets[0]).toEqual({ min: 0, max: 100, label: "0-100" });
    expect(result.buckets[1]).toEqual({ min: 100, max: 500, label: "100-500" });
    expect(result.buckets[2]).toEqual({ min: 500, max: null, label: "500+" });
  });

  it("parses ranges with K/M suffixes", () => {
    const result = parseDailyBucketsText("0-1k 1k-10k 10k+");
    expect(result.error).toBeNull();
    expect(result.buckets[0].max).toBe(1000);
    expect(result.buckets[1].min).toBe(1000);
    expect(result.buckets[1].max).toBe(10000);
    expect(result.buckets[2].min).toBe(10000);
  });

  it("returns empty for empty input", () => {
    const result = parseDailyBucketsText("");
    expect(result.buckets).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("rejects non-continuous ranges", () => {
    const result = parseDailyBucketsText("0-100 200-500");
    expect(result.error).toContain("continuous");
  });

  it("rejects open-ended bucket that isn't last", () => {
    const result = parseDailyBucketsText("0+ 100-500");
    expect(result.error).toContain("must be last");
  });

  it("rejects invalid bucket format", () => {
    const result = parseDailyBucketsText("abc");
    expect(result.error).toContain("Invalid bucket format");
  });

  it("rejects range where max <= min", () => {
    const result = parseDailyBucketsText("500-100");
    expect(result.error).toContain("Invalid bucket range");
  });
});

// ============================================================================
// formatMilestoneForInput
// ============================================================================

describe("formatMilestoneForInput", () => {
  it("formats in lowercase", () => {
    expect(formatMilestoneForInput(1_000_000)).toBe("1m");
    expect(formatMilestoneForInput(100_000)).toBe("100k");
    expect(formatMilestoneForInput(1_000_000_000)).toBe("1b");
  });
});

// ============================================================================
// formatMilestoneHeaderLabel
// ============================================================================

describe("formatMilestoneHeaderLabel", () => {
  beforeEach(() => {
    setCurrencyDisplay("USD");
  });

  it("returns uppercase milestone for streams mode", () => {
    const result = formatMilestoneHeaderLabel(1_000_000, "streams", 0.003);
    expect(result).toBe("1M");
  });

  it("returns USD compact for revenue mode", () => {
    // 1,000,000 streams * $0.003 = $3,000
    const result = formatMilestoneHeaderLabel(1_000_000, "revenue", 0.003);
    expect(result).toMatch(/\$3/);
  });
});

// ============================================================================
// rollSum
// ============================================================================

describe("rollSum", () => {
  const rows = [
    { run_date: "2026-02-13", daily_streams_net: 1000, est_revenue_daily_net: 3 },
    { run_date: "2026-02-12", daily_streams_net: 2000, est_revenue_daily_net: 6 },
    { run_date: "2026-02-11", daily_streams_net: 3000, est_revenue_daily_net: 9 },
    { run_date: "2026-02-10", daily_streams_net: 4000, est_revenue_daily_net: 12 },
  ] as any[];

  it("sums streams for N days", () => {
    expect(rollSum(rows, 2, "streams", 0.003)).toBe(3000); // 1000 + 2000
    expect(rollSum(rows, 4, "streams", 0.003)).toBe(10000); // 1000 + 2000 + 3000 + 4000
  });

  it("sums revenue for N days using payout rate", () => {
    // 1000 * 0.003 + 2000 * 0.003 = 3 + 6 = 9
    expect(rollSum(rows, 2, "revenue", 0.003)).toBeCloseTo(9, 5);
  });

  it("handles days larger than available rows", () => {
    expect(rollSum(rows, 100, "streams", 0.003)).toBe(10000);
  });

  it("handles 0 days", () => {
    expect(rollSum(rows, 0, "streams", 0.003)).toBe(0);
  });

  it("handles null daily_streams_net", () => {
    const rowsWithNull = [
      { run_date: "2026-02-13", daily_streams_net: null },
      { run_date: "2026-02-12", daily_streams_net: 2000 },
    ] as any[];
    expect(rollSum(rowsWithNull, 2, "streams", 0.003)).toBe(2000);
  });
});
