import { describe, expect, it } from "vitest";
import {
  describeMarketReasons,
  formatMarketCount,
  formatMarketsLine,
  formatScanTime,
  marketName,
  marketReasonLabel,
  tallyMarkets,
  truncateMarkets,
  unusualReasonSummary,
} from "./spotifyMarketFormat";

describe("Spotify market formatting", () => {
  it("names countries and falls back to the code", () => {
    expect(marketName("BR")).toBe("Brazil");
    expect(marketName("ZZZZ")).toBe("ZZZZ");
  });

  it("formats counts and catalog lines", () => {
    expect(formatMarketCount(179, 183)).toBe("179 / 183");
    expect(formatMarketsLine({ markets_checked: 183, available_count: 183, unavailable_markets: [] })).toBe("Spotify: all 183 markets");
    expect(
      formatMarketsLine({ markets_checked: 183, available_count: 179, unavailable_markets: ["BR", "IN", "MX", "PK"] }),
    ).toBe("Spotify: unavailable in BR, IN, MX, PK (179/183)");
  });

  it("truncates long market lists", () => {
    const codes = Array.from({ length: 15 }, (_, i) => `C${i}`);
    expect(truncateMarkets(codes, 12)).toEqual({ shown: codes.slice(0, 12), more: 3 });
    expect(truncateMarkets(["BR"], 12)).toEqual({ shown: ["BR"], more: 0 });
  });

  it("summarises reasons", () => {
    expect(describeMarketReasons({ BR: "market", IN: "market" })).toBe("market");
    expect(describeMarketReasons({ BR: "market", IN: "none" })).toBe("market, No reason given");
    expect(describeMarketReasons({})).toBe("—");
  });
});

describe("Spotify market labels", () => {
  it("explains reasons and hides the ordinary geo-block", () => {
    expect(marketReasonLabel("market")).toBe("Not released in this territory");
    expect(marketReasonLabel(undefined)).toBe("Not playable (no reason given)");
    expect(unusualReasonSummary({ BR: "market", IN: "market" })).toBeNull();
    expect(unusualReasonSummary({ BR: "market", IN: "product" })).toBe("Not released in this territory · Premium only");
  });

  it("tallies countries across tracks", () => {
    expect(
      tallyMarkets([{ unavailable_markets: ["BR", "IN"] }, { unavailable_markets: ["BR", "CA"] }]),
    ).toEqual([{ code: "BR", count: 2 }, { code: "CA", count: 1 }, { code: "IN", count: 1 }]);
  });

  it("formats scan time in UTC", () => {
    expect(formatScanTime("2026-11-07T00:03:00Z")).toBe("2026-11-07 00:03 UTC");
    expect(formatScanTime(null)).toBe("never");
  });
});
