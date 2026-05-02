import { beforeEach, describe, expect, it } from "vitest";
import { setCurrencyDisplay } from "@/lib/format";
import { formatSearchHoverStat, formatSearchRevenueStat } from "./searchBarFormat";

describe("search hover stat formatting", () => {
  beforeEach(() => {
    setCurrencyDisplay("USD");
  });

  it("keeps revenue hover stats on the shared compact money formatter", () => {
    expect(formatSearchRevenueStat(1_234.567)).toBe("$1.23K");
    expect(formatSearchHoverStat("revenue", 1_000_000, 0.004)).toBe("$4.00K");
  });

  it("respects the global AED currency display mode", () => {
    setCurrencyDisplay("AED");

    expect(formatSearchRevenueStat(1_234.567)).toBe("AED 4.53K");
  });

  it("keeps non-revenue hover stats as compact stream counts", () => {
    expect(formatSearchHoverStat("streams", 1_250, 0.004)).toBe("1.3K");
    expect(formatSearchHoverStat("tracks", 500, 0.004)).toBe("500");
  });
});
