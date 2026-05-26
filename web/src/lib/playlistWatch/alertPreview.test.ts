import { describe, expect, it } from "vitest";

import { buildAlertPreview } from "./alertPreview";

describe("buildAlertPreview", () => {
  it("counts historical days that would have triggered a configured spike rule", () => {
    const result = buildAlertPreview({
      comparisonWindowDays: 3,
      minAbsoluteJump: 250,
      minPercentJump: 20,
      history: [
        { date: "2026-05-20", followers: 1000, dailyDelta: null },
        { date: "2026-05-21", followers: 1010, dailyDelta: 10 },
        { date: "2026-05-22", followers: 990, dailyDelta: -20 },
        { date: "2026-05-23", followers: 1300, dailyDelta: 310 },
        { date: "2026-05-24", followers: 1320, dailyDelta: 20 },
      ],
    });

    expect(result.checkedDays).toBe(2);
    expect(result.triggerCount).toBe(1);
    expect(result.latestTrigger?.date).toBe("2026-05-23");
    expect(result.latestTrigger?.absoluteJump).toBe(300);
    expect(result.latestTrigger?.percentJump).toBeCloseTo(30);
  });

  it("reports when there is not enough history for the selected window", () => {
    const result = buildAlertPreview({
      comparisonWindowDays: 7,
      minAbsoluteJump: 100,
      minPercentJump: null,
      history: [
        { date: "2026-05-25", followers: 1000, dailyDelta: null },
        { date: "2026-05-26", followers: 1200, dailyDelta: 200 },
      ],
    });

    expect(result.checkedDays).toBe(0);
    expect(result.triggerCount).toBe(0);
    expect(result.needsMoreHistory).toBe(true);
  });
});
