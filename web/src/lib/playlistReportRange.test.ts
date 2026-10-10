import { describe, expect, it } from "vitest";
import { lastTwoTuesdays, reportRunDates } from "./playlistReportRange";

describe("playlist report dates", () => {
  it("preserves the default export", () => expect(reportRunDates(null, null)).toBeNull());
  it("converts inclusive data dates to run dates", () => {
    const dates = reportRunDates("2026-09-29", "2026-10-06");
    expect(dates).toHaveLength(8);
    expect(dates?.[0]).toBe("2026-10-01");
    expect(dates?.[7]).toBe("2026-10-08");
  });
  it("supports a single day and leap day", () => expect(reportRunDates("2024-02-29", "2024-02-29")).toEqual(["2024-03-02"]));
  it("rejects invalid, incomplete, reversed and excessive ranges", () => {
    for (const [a, b] of [["2026-02-30", "2026-03-01"], ["2026-10-01", null], ["", ""], ["2026-10-02", "2026-10-01"], ["2025-01-01", "2026-10-01"]]) {
      expect(() => reportRunDates(a, b)).toThrow();
    }
  });
  it("selects the latest available Tuesday and its predecessor", () => {
    expect(lastTwoTuesdays("2026-10-08")).toEqual({ start: "2026-09-29", end: "2026-10-06" });
    expect(lastTwoTuesdays("2026-10-06")).toEqual({ start: "2026-09-29", end: "2026-10-06" });
  });
});
