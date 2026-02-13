import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  dataDateFromRunDate,
  formatSotDataDateISO,
  expectedLatestRunDateUtc,
  SOT_DATA_LAG_DAYS,
} from "./sotDates";

// ---------------------------------------------------------------------------
// SOT_DATA_LAG_DAYS
// ---------------------------------------------------------------------------

describe("SOT_DATA_LAG_DAYS", () => {
  it("is 2", () => {
    expect(SOT_DATA_LAG_DAYS).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// addDaysISO
// ---------------------------------------------------------------------------

describe("addDaysISO", () => {
  it("adds positive days", () => {
    expect(addDaysISO("2026-01-10", 5)).toBe("2026-01-15");
  });

  it("subtracts days with negative delta", () => {
    expect(addDaysISO("2026-01-10", -3)).toBe("2026-01-07");
  });

  it("crosses month boundary forward", () => {
    expect(addDaysISO("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("crosses month boundary backward", () => {
    expect(addDaysISO("2026-02-01", -2)).toBe("2026-01-30");
  });

  it("crosses year boundary", () => {
    expect(addDaysISO("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles 0 delta", () => {
    expect(addDaysISO("2026-06-15", 0)).toBe("2026-06-15");
  });

  it("returns original for invalid date", () => {
    expect(addDaysISO("not-a-date", 5)).toBe("not-a-date");
  });

  it("handles leap year", () => {
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysISO("2024-02-28", 2)).toBe("2024-03-01");
  });
});

// ---------------------------------------------------------------------------
// dataDateFromRunDate
// ---------------------------------------------------------------------------

describe("dataDateFromRunDate", () => {
  it("subtracts 2 days (SOT lag)", () => {
    expect(dataDateFromRunDate("2026-02-15")).toBe("2026-02-13");
    expect(dataDateFromRunDate("2026-01-02")).toBe("2025-12-31");
  });
});

// ---------------------------------------------------------------------------
// formatSotDataDateISO
// ---------------------------------------------------------------------------

describe("formatSotDataDateISO", () => {
  it("returns the data date for a valid run date", () => {
    expect(formatSotDataDateISO("2026-02-15")).toBe("2026-02-13");
  });

  it("returns dash for null/undefined", () => {
    expect(formatSotDataDateISO(null)).toBe("—");
    expect(formatSotDataDateISO(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// expectedLatestRunDateUtc
// ---------------------------------------------------------------------------

describe("expectedLatestRunDateUtc", () => {
  it("returns today minus SOT lag", () => {
    expect(expectedLatestRunDateUtc("2026-02-13")).toBe("2026-02-11");
  });
});
