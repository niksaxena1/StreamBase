import { describe, it, expect } from "vitest";
import {
  generateAutoMilestonesFromMax,
  formatMilestoneCompact,
  DEFAULT_MIN_MILESTONE_STREAMS,
  DEFAULT_AUTO_MILESTONE_TARGET_COUNT,
} from "./milestones";

// ---------------------------------------------------------------------------
// generateAutoMilestonesFromMax
// ---------------------------------------------------------------------------

describe("generateAutoMilestonesFromMax", () => {
  it("returns empty for 0 or negative", () => {
    expect(generateAutoMilestonesFromMax(0)).toEqual([]);
    expect(generateAutoMilestonesFromMax(-100)).toEqual([]);
  });

  it("returns empty for NaN/Infinity", () => {
    expect(generateAutoMilestonesFromMax(NaN)).toEqual([]);
    expect(generateAutoMilestonesFromMax(Infinity)).toEqual([]);
  });

  it("returns empty when maxStreams is below minMilestone", () => {
    expect(generateAutoMilestonesFromMax(50_000)).toEqual([]);
  });

  it("returns milestones in descending order", () => {
    const milestones = generateAutoMilestonesFromMax(10_000_000);
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i - 1]).toBeGreaterThan(milestones[i]);
    }
  });

  it("never exceeds maxStreams", () => {
    const milestones = generateAutoMilestonesFromMax(5_000_000);
    for (const m of milestones) {
      expect(m).toBeLessThanOrEqual(5_000_000);
    }
  });

  it("all milestones are at least the minimum", () => {
    const milestones = generateAutoMilestonesFromMax(50_000_000);
    for (const m of milestones) {
      expect(m).toBeGreaterThanOrEqual(DEFAULT_MIN_MILESTONE_STREAMS);
    }
  });

  it("respects custom minMilestone", () => {
    const milestones = generateAutoMilestonesFromMax(10_000_000, { minMilestone: 1_000_000 });
    for (const m of milestones) {
      expect(m).toBeGreaterThanOrEqual(1_000_000);
    }
  });

  it("respects custom targetCount", () => {
    const milestones = generateAutoMilestonesFromMax(10_000_000_000, { targetCount: 5 });
    // Should be roughly 5 milestones (may include smallest as extra)
    expect(milestones.length).toBeLessThanOrEqual(7);
    expect(milestones.length).toBeGreaterThanOrEqual(1);
  });

  it("includes smallest milestone when thinned", () => {
    const milestones = generateAutoMilestonesFromMax(10_000_000_000, { targetCount: 5 });
    expect(milestones[milestones.length - 1]).toBe(100_000);
  });

  it("returns exact milestones for small max", () => {
    const milestones = generateAutoMilestonesFromMax(200_000);
    expect(milestones).toContain(200_000);
    expect(milestones).toContain(150_000);
    expect(milestones).toContain(100_000);
  });
});

// ---------------------------------------------------------------------------
// formatMilestoneCompact
// ---------------------------------------------------------------------------

describe("formatMilestoneCompact", () => {
  it("formats billions", () => {
    expect(formatMilestoneCompact(1_000_000_000)).toBe("1B");
    expect(formatMilestoneCompact(2_500_000_000)).toBe("2.5B");
  });

  it("formats millions", () => {
    expect(formatMilestoneCompact(1_000_000)).toBe("1M");
    expect(formatMilestoneCompact(5_500_000)).toBe("5.5M");
    expect(formatMilestoneCompact(50_000_000)).toBe("50M");
  });

  it("formats thousands", () => {
    expect(formatMilestoneCompact(1_000)).toBe("1K");
    expect(formatMilestoneCompact(100_000)).toBe("100K");
    expect(formatMilestoneCompact(750_000)).toBe("750K");
  });

  it("formats small numbers without suffix", () => {
    expect(formatMilestoneCompact(500)).toBe("500");
    expect(formatMilestoneCompact(0)).toBe("0");
  });

  it("supports lowercase case option", () => {
    expect(formatMilestoneCompact(1_000_000, { case: "lower" })).toBe("1m");
    expect(formatMilestoneCompact(100_000, { case: "lower" })).toBe("100k");
    expect(formatMilestoneCompact(1_000_000_000, { case: "lower" })).toBe("1b");
  });

  it("defaults to uppercase", () => {
    expect(formatMilestoneCompact(5_000_000)).toBe("5M");
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("DEFAULT_MIN_MILESTONE_STREAMS is 100k", () => {
    expect(DEFAULT_MIN_MILESTONE_STREAMS).toBe(100_000);
  });

  it("DEFAULT_AUTO_MILESTONE_TARGET_COUNT is 30", () => {
    expect(DEFAULT_AUTO_MILESTONE_TARGET_COUNT).toBe(30);
  });
});
