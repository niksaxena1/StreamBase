import { describe, expect, it } from "vitest";
import { groupCompetitorReleaseWeeks, groupReleaseWeeks, prettyDate, releaseBucketer, releaseWeekStart, type ReleaseWeekTrack } from "./releaseWeeks";

const track = (isrc: string, release_date: string | null, prev_streams: number | null = 10, cur_streams: number | null = 20): ReleaseWeekTrack => ({ isrc, name: isrc, artist_names: ["Artist"], release_date, prev_streams, cur_streams, reset_drop: null, reset_run_date: null, run_date: "2026-11-05" });
describe("release week grouping", () => {
  it.each([["2026-10-16", "2026-10-16"], ["2026-10-22", "2026-10-16"], ["2026-10-17", "2026-10-16"], ["2026-10-18", "2026-10-16"], ["2026-10-21", "2026-10-16"]])("maps %s to Friday %s", (date, friday) => expect(releaseWeekStart(date)).toBe(friday));
  it("places boundary releases in weekly, monthly, yearly and unknown buckets", () => {
    const result = groupReleaseWeeks([track("weekly", "2026-08-07"), track("monthly", "2026-08-06"), track("old-month", "2025-08-01"), track("year", "2025-07-31"), track("unknown", null)], "2026-11-03");
    expect(result.buckets.map(b => [b.kind, b.label])).toEqual([["week", "Week of Fri 7th Aug 2026"], ["month", "Aug 2026"], ["month", "Aug 2025"], ["year", "2025"], ["unknown", "Unknown"]]);
  });
  it("sums and sorts changes, preserves new tracks, and reports resets", () => {
    const dropped = { ...track("drop", "2026-10-16", 100, 20), reset_drop: -211473, reset_run_date: "2026-11-03" };
    const fresh = track("new", "2026-10-17", null, 10);
    const result = groupReleaseWeeks([fresh, dropped, track("up", "2026-10-18", 20, 50), track("only-new", null, null, 4)], "2026-11-03");
    const b = result.buckets[0];
    expect([b.trackCount, b.prev, b.cur, b.change, b.pct]).toEqual([3, 120, 80, -40, -40 / 120]);
    expect(b.tracks.map(t => t.isrc)).toEqual(["drop", "new", "up"]);
    expect(b.tracks[1].prev_streams).toBeNull();
    expect(result.buckets[1].pct).toBeNull();
    expect(result.resets.map(r => [r.track.isrc, r.drop, r.dataDate])).toEqual([["drop", -211473, "2026-11-01"]]);
  });
});

describe("prettyDate", () => {
  it("formats with ordinals and short months", () => {
    expect(prettyDate("2025-06-02")).toBe("2nd Jun 2025");
    expect(prettyDate("2026-09-01")).toBe("1st Sep 2026");
    expect(prettyDate("2026-10-23")).toBe("23rd Oct 2026");
    expect(prettyDate("2026-11-11")).toBe("11th Nov 2026");
    expect(prettyDate("2026-11-12")).toBe("12th Nov 2026");
    expect(prettyDate("2026-11-13")).toBe("13th Nov 2026");
    expect(prettyDate("2026-10-31")).toBe("31st Oct 2026");
    expect(prettyDate("2026-10-22")).toBe("22nd Oct 2026");
    expect(prettyDate("2026-10-16", { weekday: true })).toBe("Fri 16th Oct 2026");
    expect(prettyDate("2026-11-01", { year: false })).toBe("1st Nov");
  });
});

describe("bucket date ranges", () => {
  // data date Tue 3 Nov 2026 -> weekly floor 4 Aug (Tue) -> first weekly Friday 7 Aug; month floor Aug 2025
  const bucketFor = releaseBucketer("2026-11-03");
  it("weeks run Friday to Thursday", () => {
    expect(bucketFor("2026-10-22")).toMatchObject({ kind: "week", from: "2026-10-16", to: "2026-10-22" });
    expect(bucketFor("2026-08-07")).toMatchObject({ kind: "week", from: "2026-08-07", to: "2026-08-13" });
  });
  it("the month just before the weekly range stops the day before the first weekly Friday", () => {
    expect(bucketFor("2026-08-06")).toMatchObject({ kind: "month", key: "month:2026-08", from: "2026-08-01", to: "2026-08-06" });
    expect(bucketFor("2026-07-15")).toMatchObject({ kind: "month", from: "2026-07-01", to: "2026-07-31" });
  });
  it("the year before the monthly range stops the day before the first monthly month", () => {
    expect(bucketFor("2025-07-31")).toMatchObject({ kind: "year", key: "year:2025", from: "2025-01-01", to: "2025-07-31" });
    expect(bucketFor("2024-03-01")).toMatchObject({ kind: "year", from: "2024-01-01", to: "2024-12-31" });
    expect(bucketFor(null)).toMatchObject({ kind: "unknown", from: null, to: null });
  });
  it("every date falls inside its own bucket's range", () => {
    for (let i = 0; i < 900; i++) {
      const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      const b = bucketFor(d);
      expect(b.from! <= d && d <= b.to!).toBe(true);
    }
  });
});

describe("competitor grouping", () => {
  it("sums per label per bucket and takes the median of label % changes", () => {
    const rows = [
      { label_key: "a", release_date: "2026-10-16", tracks: 2, prev_streams: 100, cur_streams: 50 },
      { label_key: "a", release_date: "2026-10-20", tracks: 1, prev_streams: 100, cur_streams: 90 },
      { label_key: "b", release_date: "2026-10-17", tracks: 1, prev_streams: 200, cur_streams: 180 },
      { label_key: "c", release_date: "2026-10-18", tracks: 1, prev_streams: 0, cur_streams: 40 },
      { label_key: "b", release_date: "2026-10-23", tracks: 1, prev_streams: 10, cur_streams: 20 },
    ];
    const out = groupCompetitorReleaseWeeks(rows, "2026-11-03");
    const wk = out.get("week:2026-10-16")!;
    expect(wk.labels.map((l) => [l.labelKey, l.tracks, l.prev, l.cur])).toEqual([["a", 3, 200, 140], ["b", 1, 200, 180], ["c", 1, 0, 40]]);
    expect(wk.withPct).toBe(2);
    expect(wk.medianPct).toBeCloseTo((-0.3 + -0.1) / 2);
    expect(out.get("week:2026-10-23")!.medianPct).toBeCloseTo(1);
  });
});
