import { describe, expect, it } from "vitest";

import {
  addedDateOf,
  buildChartData,
  computeStats,
  dailyGainPoints,
  filterByRange,
  generateDemoHistory,
  normalizeSnapshots,
  rangeStart,
  snapMarkerDate,
  trackingStartedNote,
  type HistorySnapshot,
} from "./trackHistoryModel";

const snaps: HistorySnapshot[] = [
  { date: "2026-11-01", playcount: 100 },
  { date: "2026-11-02", playcount: 150 },
  { date: "2026-11-05", playcount: 300 }, // 3-day gap
  { date: "2026-11-06", playcount: 340 },
];

describe("normalizeSnapshots", () => {
  it("sorts, dedupes and drops bad rows", () => {
    const out = normalizeSnapshots([
      { date: "2026-11-02", playcount: "20" },
      { date: "2026-11-01", playcount: 10 },
      { date: "2026-11-02", playcount: 25 },
      { date: "bad", playcount: 1 },
      { date: "2026-11-03", playcount: null },
    ]);
    expect(out).toEqual([
      { date: "2026-11-01", playcount: 10 },
      { date: "2026-11-02", playcount: 25 },
    ]);
  });
});

describe("dailyGainPoints", () => {
  it("returns nothing for fewer than two snapshots", () => {
    expect(dailyGainPoints([])).toEqual([]);
    expect(dailyGainPoints(snaps.slice(0, 1))).toEqual([]);
  });
  it("marks gaps with the number of days covered", () => {
    expect(dailyGainPoints(snaps)).toEqual([
      { date: "2026-11-02", gain: 50, days: 1 },
      { date: "2026-11-05", gain: 150, days: 3 },
      { date: "2026-11-06", gain: 40, days: 1 },
    ]);
  });
});

describe("range filtering", () => {
  const wide = [
    { date: "2026-09-01", playcount: 1 },
    { date: "2026-10-20", playcount: 2 },
    { date: "2026-11-05", playcount: 3 },
    { date: "2026-11-06", playcount: 4 },
  ];
  it("anchors on the newest date, inclusive", () => {
    expect(rangeStart("2026-11-06", "7d")).toBe("2026-10-31");
    expect(rangeStart("2026-11-06", "all")).toBeNull();
    expect(rangeStart(null, "7d")).toBeNull();
  });
  it("filters by range", () => {
    expect(filterByRange(wide, "all")).toHaveLength(4);
    expect(filterByRange(wide, "7d").map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(filterByRange(wide, "28d").map((d) => d.date)).toEqual(["2026-10-20", "2026-11-05", "2026-11-06"]);
    expect(filterByRange(wide, "90d")).toHaveLength(4);
    expect(filterByRange([], "7d")).toEqual([]);
  });
});

describe("buildChartData", () => {
  it("returns newest-first daily points with _bucketDays only on gaps", () => {
    const data = buildChartData(snaps, "daily", "all");
    expect(data.map((d) => d.date)).toEqual(["2026-11-06", "2026-11-05", "2026-11-02"]);
    expect(data[1]._bucketDays).toBe(3);
    expect(data[0]._bucketDays).toBeUndefined();
  });
  it("returns cumulative totals including the first snapshot", () => {
    const data = buildChartData(snaps, "total", "all");
    expect(data).toHaveLength(4);
    expect(data[3]).toEqual({ date: "2026-11-01", value: 100 });
  });
});

describe("snapMarkerDate", () => {
  const dates = ["2026-11-06", "2026-11-05", "2026-11-02"];
  it("snaps forward to the next chart date", () => {
    expect(snapMarkerDate("2026-11-03", dates)).toBe("2026-11-05");
    expect(snapMarkerDate("2026-11-02", dates)).toBe("2026-11-02");
  });
  it("is null when outside the visible range", () => {
    expect(snapMarkerDate("2026-10-01", dates)).toBeNull();
    expect(snapMarkerDate("2026-11-07", dates)).toBeNull();
    expect(snapMarkerDate(null, dates)).toBeNull();
    expect(snapMarkerDate("2026-11-02", [])).toBeNull();
  });
});

describe("computeStats", () => {
  it("is null with fewer than two snapshots", () => {
    expect(computeStats(snaps.slice(0, 1), null)).toBeNull();
  });
  it("measures from the first snapshot on/after first_seen_date", () => {
    const stats = computeStats(snaps, { added_at: null, first_seen_date: "2026-11-02", removed_date: null });
    expect(stats).toEqual({ streamsSinceAdded: 190, avgPerDay: 190 / 4, bestDay: { date: "2026-11-02", value: 50 }, daysTracked: 4 });
  });
  it("falls back to the first snapshot without membership", () => {
    expect(computeStats(snaps, null)?.streamsSinceAdded).toBe(240);
  });
});

describe("trackingStartedNote", () => {
  it("returns the first snapshot date when added earlier", () => {
    expect(trackingStartedNote(snaps, { added_at: "2026-10-01T10:00:00Z", first_seen_date: "2026-11-01", removed_date: null })).toBe("2026-11-01");
  });
  it("is null when added on/after the first snapshot", () => {
    expect(trackingStartedNote(snaps, { added_at: "2026-11-01T10:00:00Z", first_seen_date: "2026-11-01", removed_date: null })).toBeNull();
    expect(trackingStartedNote([], null)).toBeNull();
  });
  it("uses first_seen_date when added_at is missing", () => {
    expect(addedDateOf({ added_at: null, first_seen_date: "2026-11-01", removed_date: null })).toBe("2026-11-01");
  });
});

describe("generateDemoHistory", () => {
  const a = generateDemoHistory({ trackId: "abc", latestPlaycount: 52_345, lastDate: "2026-11-04" });
  it("is deterministic and ends at the latest playcount", () => {
    expect(generateDemoHistory({ trackId: "abc", latestPlaycount: 52_345, lastDate: "2026-11-04" })).toEqual(a);
    expect(a.snapshots).toHaveLength(45);
    expect(a.snapshots[44]).toEqual({ date: "2026-11-04", playcount: 52_345 });
    expect(a.snapshots[0].date).toBe("2026-09-21");
  });
  it("is strictly ascending with an added date 20 days ago and a bump after it", () => {
    for (let i = 1; i < a.snapshots.length; i++) expect(a.snapshots[i].playcount).toBeGreaterThan(a.snapshots[i - 1].playcount);
    expect(a.membership?.first_seen_date).toBe("2026-10-15");
    const gains = dailyGainPoints(a.snapshots).map((p) => p.gain);
    const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(avg(gains.slice(24, 28))).toBeGreaterThan(avg(gains.slice(0, 20)));
  });
  it("differs per track", () => {
    expect(generateDemoHistory({ trackId: "zzz", latestPlaycount: 52_345, lastDate: "2026-11-04" })).not.toEqual(a);
  });
});
