import { describe, expect, it } from "vitest";
import {
  compactNumber,
  dateKey,
  formatUtcDate,
  fullNumber,
  monthBucket,
  monthLabel,
  percent,
  signedDelta,
  weekStart,
} from "./format";
describe("formatting", () => {
  it("formats compact values and signs", () => {
    expect(compactNumber(1200)).toBe("1.2K");
    expect(compactNumber(3400000)).toBe("3.4M");
    expect(compactNumber(1100000000)).toBe("1.1B");
    expect(compactNumber(-1200)).toBe("-1.2K");
  });
  it("formats full numbers, deltas and fractional percentages", () => {
    expect(fullNumber(1234567)).toBe("1,234,567");
    expect(signedDelta(1234)).toBe("+1,234");
    expect(signedDelta(-23)).toBe("-23");
    expect(signedDelta(0)).toBe("0");
    expect(percent(0.875)).toBe("87.5%");
  });
  it("keeps unavailable values distinct from zero", () => {
    expect(fullNumber(null)).toBe("—");
    expect(compactNumber(NaN)).toBe("—");
    expect(percent(null)).toBe("—");
    expect(fullNumber(0)).toBe("0");
  });
  it("uses UTC dates, ISO Mondays and month labels in Dubai", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Dubai";
    try {
      expect(formatUtcDate("2024-03-05")).toBe("5 Mar 2024");
      expect(formatUtcDate("2024-03-05T23:59:00Z")).toBe("5 Mar 2024");
      expect(dateKey("2024-03-05T23:59:00")).toBe("2024-03-05");
      expect(dateKey("2024-03-06T01:00:00+04:00")).toBe("2024-03-05");
      expect(weekStart("2024-03-10")).toBe("2024-03-04");
      expect(weekStart("2024-03-04")).toBe("2024-03-04");
      expect(weekStart("2025-01-01")).toBe("2024-12-30");
      expect(monthBucket("2024-03-31T23:00:00Z")).toBe("2024-03");
      expect(monthLabel("2024-03")).toBe("Mar 2024");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
