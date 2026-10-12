import { describe, expect, it } from "vitest";

import { sortRows } from "./filters";
import {
  dailyFromCumulative,
  formatCompactStreams,
  formatExactStreams,
  isStreamRange,
  mergeStreams,
  normalizeStream,
  normalizeStreamPoint,
  streamsAsOf,
} from "./streams";
import { makeRow } from "./testRows";

describe("normalizeStream", () => {
  it("coerces bigint strings and blanks", () => {
    expect(
      normalizeStream({
        catalog_id: "TG-1",
        isrc: "USABC2600001",
        total_streams: "1234567",
        streams_7d: 89,
        as_of: "2026-10-11",
        album_image_url: "",
        spotify_track_id: "abc",
      }),
    ).toEqual({
      catalog_id: "TG-1",
      isrc: "USABC2600001",
      total_streams: 1234567,
      streams_7d: 89,
      as_of: "2026-10-11",
      album_image_url: null,
      spotify_track_id: "abc",
    });
  });
  it("treats missing numbers as null", () => {
    const s = normalizeStream({ catalog_id: "TG-1" });
    expect(s.total_streams).toBeNull();
    expect(s.streams_7d).toBeNull();
  });
});

describe("mergeStreams", () => {
  const streams = [
    normalizeStream({
      catalog_id: "TG-1",
      isrc: "USABC2600001",
      total_streams: 1000,
      streams_7d: 50,
      album_image_url: "https://i.scdn.co/a",
      spotify_track_id: "x1",
      as_of: "2026-10-11",
    }),
  ];
  it("sets stream fields on matching rows and leaves the rest alone", () => {
    const rows = [makeRow({ catalog_id: "TG-1", isrc: "USABC2600001" }), makeRow({ catalog_id: "TG-2" })];
    const merged = mergeStreams(rows, streams);
    expect(merged[0]).toMatchObject({
      total_streams: 1000,
      streams_7d: 50,
      album_image_url: "https://i.scdn.co/a",
      spotify_track_id: "x1",
    });
    expect(merged[1]).toBe(rows[1]);
    expect(merged[1].total_streams).toBeUndefined();
  });
  it("returns the same list when there are no streams (the load failed)", () => {
    const rows = [makeRow()];
    expect(mergeStreams(rows, [])).toBe(rows);
  });
  it("keeps stream data on an edited row that replaced the original", () => {
    const edited = makeRow({ catalog_id: "TG-1", isrc: "USABC2600001", sheet_title: "Edited" });
    expect(mergeStreams([edited], streams)[0]).toMatchObject({ sheet_title: "Edited", total_streams: 1000 });
  });
  it("drops the figures when the row's ISRC no longer matches (ISRC edited or cleared)", () => {
    const changed = makeRow({ catalog_id: "TG-1", isrc: "USXYZ2600009" });
    const cleared = makeRow({ catalog_id: "TG-1", isrc: null });
    expect(mergeStreams([changed], streams)[0].total_streams).toBeUndefined();
    expect(mergeStreams([cleared], streams)[0].total_streams).toBeUndefined();
  });
  it("reads the as-of date", () => {
    expect(streamsAsOf(streams)).toBe("2026-10-11");
    expect(streamsAsOf([])).toBeNull();
  });
});

describe("sorting by streams", () => {
  const withStreams = (id: string, total: number, week: number) =>
    mergeStreams([makeRow({ catalog_id: id, isrc: `ISRC${id}` })], [normalizeStream({ catalog_id: id, isrc: `ISRC${id}`, total_streams: total, streams_7d: week })])[0];
  const rows = [withStreams("A", 5, 9), withStreams("B", 50, 1), makeRow({ catalog_id: "C" })];
  it("orders by total or 7-day streams and puts rows without streams last", () => {
    expect(sortRows(rows, "streams", "desc").map((r) => r.catalog_id)).toEqual(["B", "A", "C"]);
    expect(sortRows(rows, "streams", "asc").map((r) => r.catalog_id)).toEqual(["A", "B", "C"]);
    expect(sortRows(rows, "streams7d", "desc").map((r) => r.catalog_id)).toEqual(["A", "B", "C"]);
  });
});

describe("formatCompactStreams", () => {
  it("compacts thousands, millions and billions", () => {
    expect(formatCompactStreams(0)).toBe("0");
    expect(formatCompactStreams(950)).toBe("950");
    expect(formatCompactStreams(1000)).toBe("1K");
    expect(formatCompactStreams(12_345)).toBe("12.3K");
    expect(formatCompactStreams(1_234_567)).toBe("1.2M");
    expect(formatCompactStreams(150_000)).toBe("150K");
    expect(formatCompactStreams(2_000_000)).toBe("2M");
    expect(formatCompactStreams(1_500_000_000)).toBe("1.5B");
  });
  it("rolls 999,950 and above over to the next unit", () => {
    expect(formatCompactStreams(999_999)).toBe("1M");
  });
  it("returns an empty string for missing values", () => {
    expect(formatCompactStreams(null)).toBe("");
    expect(formatCompactStreams(undefined)).toBe("");
  });
  it("gives the exact figure with thousands separators", () => {
    expect(formatExactStreams(1234567)).toBe("1,234,567");
    expect(formatExactStreams(null)).toBe("");
  });
});

describe("dailyFromCumulative", () => {
  it("takes differences and skips the first point", () => {
    const points = [
      { date: "2026-10-01", streams_cumulative: 100 },
      { date: "2026-10-02", streams_cumulative: 130 },
      { date: "2026-10-03", streams_cumulative: 135 },
    ];
    expect(dailyFromCumulative(points)).toEqual([
      { date: "2026-10-02", value: 30 },
      { date: "2026-10-03", value: 5 },
    ]);
  });
  it("clamps negative differences to zero", () => {
    const points = [
      { date: "2026-10-01", streams_cumulative: 200 },
      { date: "2026-10-02", streams_cumulative: 150 },
      { date: "2026-10-03", streams_cumulative: 160 },
    ];
    expect(dailyFromCumulative(points).map((p) => p.value)).toEqual([0, 10]);
  });
  it("spreads the increase over missing days and marks them estimated", () => {
    const points = [
      { date: "2026-10-01", streams_cumulative: 100 },
      { date: "2026-10-03", streams_cumulative: 160 },
    ];
    expect(dailyFromCumulative(points)).toEqual([
      { date: "2026-10-02", value: 30, estimated: true },
      { date: "2026-10-03", value: 30, estimated: true },
    ]);
  });
  it("spreads across month boundaries", () => {
    const out = dailyFromCumulative([
      { date: "2026-09-29", streams_cumulative: 0 },
      { date: "2026-10-02", streams_cumulative: 90 },
    ]);
    expect(out.map((p) => p.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(out.every((p) => p.value === 30)).toBe(true);
  });
  it("returns nothing for fewer than two points", () => {
    expect(dailyFromCumulative([])).toEqual([]);
    expect(dailyFromCumulative([{ date: "2026-10-01", streams_cumulative: 1 }])).toEqual([]);
  });
});

describe("series helpers", () => {
  it("normalizes points and drops broken ones", () => {
    expect(normalizeStreamPoint({ date: "2026-10-01", streams_cumulative: "42" })).toEqual({ date: "2026-10-01", streams_cumulative: 42 });
    expect(normalizeStreamPoint({ date: null, streams_cumulative: 1 })).toBeNull();
    expect(normalizeStreamPoint({ date: "2026-10-01", streams_cumulative: null })).toBeNull();
  });
  it("accepts only the three ranges", () => {
    expect(isStreamRange(30)).toBe(true);
    expect(isStreamRange(365)).toBe(true);
    expect(isStreamRange(7)).toBe(false);
    expect(isStreamRange("90")).toBe(false);
  });
});
