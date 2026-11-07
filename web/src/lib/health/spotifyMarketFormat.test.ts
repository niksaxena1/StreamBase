import { describe, expect, it } from "vitest";
import { describeMarketReasons, formatMarketCount, formatMarketsLine, marketName, truncateMarkets } from "./spotifyMarketFormat";

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
