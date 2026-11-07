import { describe, expect, it } from "vitest";
import {
  describeMarketReasons,
  buildTerritoryTimeline,
  formatCoverageLine,
  formatMarketCount,
  formatMarketsLine,
  formatScanTime,
  marketName,
  marketReasonLabel,
  scanStaleness,
  timelineLabel,
  uncheckedReasonLabel,
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
    expect(formatScanTime("2026-11-07T00:03:00Z")).toBe("07 Nov 2026, 00:03 UTC");
    expect(formatScanTime(null)).toBe("never");
  });
});

describe("Territory scan health and history", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("flags a scan older than 36 hours as stale", () => {
    expect(scanStaleness("2026-11-07T21:15:00Z", now)).toEqual({ stale: false, message: null });
    const stale = scanStaleness("2026-11-06T21:15:00Z", now);
    expect(stale.stale).toBe(true);
    expect(stale.message).toContain("hasn't succeeded since");
    expect(scanStaleness(null, now).stale).toBe(false);
  });

  it("formats the coverage line and unchecked reasons", () => {
    expect(formatCoverageLine(3152, 3172)).toBe("Checked 3,152 of 3,172 catalog tracks");
    expect(uncheckedReasonLabel("taken_down")).toBe("Taken down (skipped until it's back)");
    expect(uncheckedReasonLabel("not_checked")).toBe("Not checked yet");
  });

  it("builds a newest-first timeline with merged same-day events and a limit", () => {
    const tl = buildTerritoryTimeline(
      [
        { market: "CA", event: "lost", reason: null, detected_at: "2026-11-07T21:00:00Z" },
        { market: "BR", event: "lost", reason: null, detected_at: "2026-11-07T21:00:00Z" },
        { market: "CA", event: "gained", reason: null, detected_at: "2026-11-10T21:00:00Z" },
      ] as never,
      [{ event: "taken_down", reason: null, detected_at: "2026-11-09T08:00:00Z" }] as never,
    );
    expect(tl.map(timelineLabel)).toEqual(["Regained CA", "Taken down", "Lost BR CA"]);
    expect(buildTerritoryTimeline(
      [
        { market: "CA", event: "lost", reason: null, detected_at: "2026-11-07T21:00:00Z" },
        { market: "CA", event: "gained", reason: null, detected_at: "2026-11-08T21:00:00Z" },
      ] as never, [], 1)).toHaveLength(1);
  });
});
