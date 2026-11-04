import { describe, expect, it } from "vitest";

import {
  dailyGains,
  filterRows,
  formatPercent,
  growthFor,
  growthPercentFor,
  isNewlyAdded,
  normalizeRow,
  parseMetric,
  parseWindow,
  sortRows,
  splitRemoved,
  summarize,
  type UploadTrackRow,
} from "./uploadTracksModel";

function row(over: Partial<UploadTrackRow> & { name: string }): UploadTrackRow {
  return {
    spotifyTrackId: over.name,
    artists: "A",
    imageUrl: null,
    addedDate: "2026-10-01",
    removedDate: null,
    latestDate: "2026-11-04",
    latestPlaycount: 1000,
    playcount1d: 990,
    playcount7d: 900,
    playcount28d: 500,
    playcountAtAdd: 100,
    history: [],
    ...over,
  };
}

describe("normalizeRow", () => {
  it("coerces bigint strings, falls back to first_seen_date, sorts history", () => {
    const r = normalizeRow({
      spotify_track_id: "t1",
      name: "N",
      artists: "X, Y",
      added_at: null,
      first_seen_date: "2026-10-30",
      removed_date: null,
      latest_playcount: "12345",
      playcount_7d: "12000",
      playcount_1d: null,
      history: [["2026-11-02", "5"], ["2026-11-01", 3]],
    });
    expect(r.latestPlaycount).toBe(12345);
    expect(r.playcount7d).toBe(12000);
    expect(r.playcount1d).toBeNull();
    expect(r.addedDate).toBe("2026-10-30");
    expect(r.history).toEqual([["2026-11-01", 3], ["2026-11-02", 5]]);
  });

  it("prefers added_at date part", () => {
    expect(normalizeRow({ added_at: "2026-10-03T08:00:00+00:00", first_seen_date: "2026-10-04" }).addedDate).toBe("2026-10-03");
  });
});

describe("growth", () => {
  it("computes absolute and percent per window", () => {
    const r = row({ name: "a" });
    expect(growthFor(r, "7d")).toBe(100);
    expect(growthPercentFor(r, "7d")).toBeCloseTo(11.111, 2);
    expect(growthFor(r, "added")).toBe(900);
    expect(growthPercentFor(r, "added")).toBe(900);
  });

  it("returns null for missing data and zero baseline percent", () => {
    expect(growthFor(row({ name: "a", playcount28d: null }), "28d")).toBeNull();
    expect(growthFor(row({ name: "a", latestPlaycount: null }), "7d")).toBeNull();
    const zero = row({ name: "a", playcountAtAdd: 0 });
    expect(growthFor(zero, "added")).toBe(1000);
    expect(growthPercentFor(zero, "added")).toBeNull();
  });

  it("formats percent", () => {
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(11.111)).toBe("+11.1%");
    expect(formatPercent(-2.5)).toBe("-2.50%");
    expect(formatPercent(250)).toBe("+250%");
  });
});

describe("dailyGains / isNewlyAdded", () => {
  it("diffs consecutive points", () => {
    expect(dailyGains([["a", 1], ["b", 4], ["c", 10]])).toEqual([3, 6]);
    expect(dailyGains([["a", 1]])).toEqual([]);
  });
  it("flags tracks added in the last 7 days", () => {
    expect(isNewlyAdded("2026-10-29", "2026-11-04")).toBe(true);
    expect(isNewlyAdded("2026-10-27", "2026-11-04")).toBe(false);
    expect(isNewlyAdded(null, "2026-11-04")).toBe(false);
  });
});

describe("sorting and splitting", () => {
  const rows = [
    row({ name: "low", latestPlaycount: 1000, playcount7d: 990 }),
    row({ name: "high", latestPlaycount: 5000, playcount7d: 3000 }),
    row({ name: "none", latestPlaycount: 700, playcount7d: null }),
  ];

  it("sorts by growth desc with nulls last in both directions", () => {
    expect(sortRows(rows, "growth", "desc", "7d", "abs").map((r) => r.name)).toEqual(["high", "low", "none"]);
    expect(sortRows(rows, "growth", "asc", "7d", "abs").map((r) => r.name)).toEqual(["low", "high", "none"]);
  });

  it("sorts by percent metric", () => {
    expect(sortRows(rows, "growth", "desc", "7d", "pct").map((r) => r.name)).toEqual(["high", "low", "none"]);
  });

  it("sorts by streams and track name", () => {
    expect(sortRows(rows, "streams", "desc", "7d", "abs").map((r) => r.name)).toEqual(["high", "low", "none"]);
    expect(sortRows(rows, "track", "asc", "7d", "abs").map((r) => r.name)).toEqual(["high", "low", "none"]);
  });

  it("splits removed rows", () => {
    const { current, removed } = splitRemoved([...rows, row({ name: "gone", removedDate: "2026-11-01" })]);
    expect(current).toHaveLength(3);
    expect(removed.map((r) => r.name)).toEqual(["gone"]);
  });

  it("filters by track or artist", () => {
    expect(filterRows([row({ name: "Song", artists: "Bob" })], "bob")).toHaveLength(1);
    expect(filterRows([row({ name: "Song", artists: "Bob" })], "zzz")).toHaveLength(0);
  });
});

describe("summarize / params", () => {
  it("sums streams and growth, picks top gainer", () => {
    const s = summarize(
      [
        row({ name: "a", latestPlaycount: 1000, playcount7d: 900 }),
        row({ name: "b", latestPlaycount: 500, playcount7d: 200 }),
        row({ name: "c", playcount7d: null }),
      ],
      "7d",
    );
    expect(s.trackCount).toBe(3);
    expect(s.totalStreams).toBe(2500);
    expect(s.windowGrowth).toBe(400);
    expect(s.topGainer?.row.name).toBe("b");
  });

  it("returns null growth with no baselines", () => {
    const s = summarize([row({ name: "a", playcount7d: null })], "7d");
    expect(s.windowGrowth).toBeNull();
    expect(s.topGainer).toBeNull();
  });

  it("parses params with defaults", () => {
    expect(parseWindow("bogus")).toBe("7d");
    expect(parseWindow("28d")).toBe("28d");
    expect(parseMetric("pct")).toBe("pct");
    expect(parseMetric(undefined)).toBe("abs");
  });
});
