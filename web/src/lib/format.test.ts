import { describe, it, expect, beforeEach } from "vitest";
import {
  formatInt,
  formatMoney,
  formatUsd,
  formatUsd2,
  formatDateISO,
  formatDateOrdinalDMonYYYY,
  setCurrencyDisplay,
  getCurrencyDisplay,
  AED_PER_USD,
} from "./format";

// ---------------------------------------------------------------------------
// formatInt
// ---------------------------------------------------------------------------

describe("formatInt", () => {
  it("formats integers with thousand separators", () => {
    expect(formatInt(1000)).toBe("1,000");
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(0)).toBe("0");
    expect(formatInt(42)).toBe("42");
  });

  it("returns dash for null/undefined", () => {
    expect(formatInt(null)).toBe("—");
    expect(formatInt(undefined)).toBe("—");
  });

  it("handles negative numbers", () => {
    expect(formatInt(-1500)).toBe("-1,500");
  });
});

// ---------------------------------------------------------------------------
// formatMoney / formatUsd / formatUsd2
// ---------------------------------------------------------------------------

describe("formatMoney", () => {
  beforeEach(() => {
    setCurrencyDisplay("USD");
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
    expect(formatMoney(Infinity)).toBe("—");
  });

  it("formats USD with default 0 decimals", () => {
    const result = formatMoney(1234);
    expect(result).toBe("$1,234");
  });

  it("formats USD with 2 decimals", () => {
    const result = formatMoney(1234.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(result).toBe("$1,234.50");
  });

  it("formats AED when currency display is AED", () => {
    setCurrencyDisplay("AED");
    const result = formatMoney(100);
    // 100 * 3.6725 = 367.25 → "AED 367"
    expect(result).toMatch(/^AED\s/);
    expect(result).toContain("367");
  });

  it("formatUsd returns 0 decimal places", () => {
    const result = formatUsd(99.99);
    expect(result).toBe("$100");
  });

  it("formatUsd2 returns 2 decimal places", () => {
    const result = formatUsd2(99.99);
    expect(result).toBe("$99.99");
  });

  it("formatUsd handles null", () => {
    expect(formatUsd(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// setCurrencyDisplay / getCurrencyDisplay
// ---------------------------------------------------------------------------

describe("setCurrencyDisplay / getCurrencyDisplay", () => {
  it("defaults to USD", () => {
    setCurrencyDisplay("USD");
    expect(getCurrencyDisplay()).toBe("USD");
  });

  it("switches to AED", () => {
    setCurrencyDisplay("AED");
    expect(getCurrencyDisplay()).toBe("AED");
  });

  it("falls back to USD for invalid input", () => {
    setCurrencyDisplay("INVALID" as any);
    expect(getCurrencyDisplay()).toBe("USD");
  });
});

// ---------------------------------------------------------------------------
// AED_PER_USD
// ---------------------------------------------------------------------------

describe("AED_PER_USD", () => {
  it("is a known constant", () => {
    expect(AED_PER_USD).toBe(3.6725);
  });
});

// ---------------------------------------------------------------------------
// formatDateISO
// ---------------------------------------------------------------------------

describe("formatDateISO", () => {
  it("returns the date string unchanged", () => {
    expect(formatDateISO("2026-01-15")).toBe("2026-01-15");
  });

  it("returns dash for falsy inputs", () => {
    expect(formatDateISO(null)).toBe("—");
    expect(formatDateISO(undefined)).toBe("—");
    expect(formatDateISO("")).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// formatDateOrdinalDMonYYYY
// ---------------------------------------------------------------------------

describe("formatDateOrdinalDMonYYYY", () => {
  it("formats standard dates", () => {
    expect(formatDateOrdinalDMonYYYY("2019-04-12")).toBe("12th Apr 2019");
    expect(formatDateOrdinalDMonYYYY("2026-01-01")).toBe("1st Jan 2026");
    expect(formatDateOrdinalDMonYYYY("2026-03-02")).toBe("2nd Mar 2026");
    expect(formatDateOrdinalDMonYYYY("2026-07-03")).toBe("3rd Jul 2026");
  });

  it("handles special ordinal suffixes (11th, 12th, 13th)", () => {
    expect(formatDateOrdinalDMonYYYY("2026-05-11")).toBe("11th May 2026");
    expect(formatDateOrdinalDMonYYYY("2026-05-12")).toBe("12th May 2026");
    expect(formatDateOrdinalDMonYYYY("2026-05-13")).toBe("13th May 2026");
  });

  it("handles 21st, 22nd, 23rd", () => {
    expect(formatDateOrdinalDMonYYYY("2026-06-21")).toBe("21st Jun 2026");
    expect(formatDateOrdinalDMonYYYY("2026-06-22")).toBe("22nd Jun 2026");
    expect(formatDateOrdinalDMonYYYY("2026-06-23")).toBe("23rd Jun 2026");
  });

  it("returns dash for null/undefined/empty/invalid", () => {
    expect(formatDateOrdinalDMonYYYY(null)).toBe("—");
    expect(formatDateOrdinalDMonYYYY(undefined)).toBe("—");
    expect(formatDateOrdinalDMonYYYY("")).toBe("—");
    expect(formatDateOrdinalDMonYYYY("not-a-date")).toBe("—");
  });
});
