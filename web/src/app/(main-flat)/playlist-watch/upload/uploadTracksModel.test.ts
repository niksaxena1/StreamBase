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
  fridayBaseline,
  formatFridayLabel,
  isReleasedSince,
  latestSnapshotDateOf,
  parseWindow,
  referenceFriday,
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
    releaseDate: "2020-01-01",
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
    expect(parseWindow("bogus")).toBe("fri");
    expect(parseWindow(undefined)).toBe("fri");
    expect(parseWindow("fri")).toBe("fri");
    expect(parseWindow("7d")).toBe("7d");
    expect(parseWindow("28d")).toBe("28d");
    expect(parseMetric("pct")).toBe("pct");
    expect(parseMetric(undefined)).toBe("abs");
  });
});

describe("Since Fri window", () => {
  it("picks the most recent Friday strictly before the latest snapshot", () => {
    expect(referenceFriday("2026-11-04")).toBe("2026-10-30"); // Wed
    expect(referenceFriday("2026-11-01")).toBe("2026-10-30"); // Sun
    expect(referenceFriday("2026-10-31")).toBe("2026-10-30"); // Sat -> yesterday
    expect(referenceFriday("2026-10-30")).toBe("2026-10-23"); // Fri -> a week earlier
    expect(referenceFriday("2026-10-29")).toBe("2026-10-23"); // Thu
    expect(referenceFriday(null)).toBeNull();
    expect(referenceFriday("nope")).toBeNull();
  });
  it("labels the reference Friday", () => {
    expect(formatFridayLabel("2026-10-30")).toBe("Fri 30 Oct");
    expect(formatFridayLabel(null)).toBe("Fri");
  });
  it("finds the latest snapshot date across rows", () => {
    expect(
      latestSnapshotDateOf([
        row({ name: "a", latestDate: "2026-11-02" }),
        row({ name: "b", latestDate: "2026-11-04" }),
        row({ name: "c", latestDate: null }),
      ]),
    ).toBe("2026-11-04");
    expect(latestSnapshotDateOf([])).toBeNull();
  });
  it("treats only full dates on/after the Friday as new releases", () => {
    expect(isReleasedSince("2026-10-30", "2026-10-30")).toBe(true);
    expect(isReleasedSince("2026-11-03", "2026-10-30")).toBe(true);
    expect(isReleasedSince("2026-10-29", "2026-10-30")).toBe(false);
    expect(isReleasedSince("2026", "2026-10-30")).toBe(false);
    expect(isReleasedSince("2026-11", "2026-10-30")).toBe(false);
    expect(isReleasedSince(null, "2026-10-30")).toBe(false);
  });
  const hist: [string, number][] = [
    ["2026-10-28", 100],
    ["2026-10-29", 120],
    ["2026-11-01", 200],
    ["2026-11-04", 260],
  ];
  it("uses 0 for new releases, else the latest point on/before the Friday, else the first after", () => {
    const ref = "2026-10-30";
    expect(fridayBaseline(row({ name: "n", releaseDate: "2026-10-30", history: hist }), ref)).toBe(0);
    expect(fridayBaseline(row({ name: "o", history: hist }), ref)).toBe(120);
    expect(fridayBaseline(row({ name: "o", history: [["2026-10-30", 150], ["2026-11-01", 200]] }), ref)).toBe(150);
    expect(fridayBaseline(row({ name: "late", history: [["2026-11-01", 200], ["2026-11-04", 260]] }), ref)).toBe(200);
    expect(fridayBaseline(row({ name: "none", history: [] }), ref)).toBeNull();
    expect(fridayBaseline(row({ name: "x", history: hist }), null)).toBeNull();
  });
  it("computes growth, drops % on a zero baseline, and ranks them after % rows in % mode", () => {
    const ref = "2026-10-30";
    const fresh = row({ name: "fresh", releaseDate: "2026-10-31", latestPlaycount: 5000, history: [["2026-11-04", 5000]] });
    const old = row({ name: "old", latestPlaycount: 260, history: hist });
    expect(growthFor(fresh, "fri", ref)).toBe(5000);
    expect(growthPercentFor(fresh, "fri", ref)).toBeNull();
    expect(growthFor(old, "fri", ref)).toBe(140);
    expect(growthPercentFor(old, "fri", ref)).toBeCloseTo(116.67, 1);
    expect(sortRows([fresh, old], "growth", "desc", "fri", "pct", ref).map((r) => r.name)).toEqual(["old", "fresh"]);
    expect(sortRows([old, fresh], "growth", "desc", "fri", "abs", ref).map((r) => r.name)).toEqual(["fresh", "old"]);
  });
  it("ranks several zero-baseline rows by absolute growth in % mode", () => {
    const ref = "2026-10-30";
    const a = row({ name: "a", releaseDate: "2026-10-31", latestPlaycount: 300, history: [] });
    const b = row({ name: "b", releaseDate: "2026-11-01", latestPlaycount: 900, history: [] });
    expect(sortRows([a, b], "growth", "desc", "fri", "pct", ref).map((r) => r.name)).toEqual(["b", "a"]);
  });
  it("feeds the summary tiles", () => {
    const ref = "2026-10-30";
    const fresh = row({ name: "fresh", releaseDate: "2026-10-31", latestPlaycount: 5000, history: [] });
    const old = row({ name: "old", latestPlaycount: 260, history: hist });
    const s = summarize([fresh, old], "fri", ref);
    expect(s.windowGrowth).toBe(5140);
    expect(s.topGainer?.row.name).toBe("fresh");
  });
  it("normalizeRow keeps the raw release date", () => {
    expect(normalizeRow({ spotify_track_id: "t", release_date: "2026-10" }).releaseDate).toBe("2026-10");
    expect(normalizeRow({ spotify_track_id: "t" }).releaseDate).toBeNull();
  });
});
