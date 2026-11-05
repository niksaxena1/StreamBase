import { describe, expect, it } from "vitest";
import { groupReleaseWeeks, releaseWeekStart, type ReleaseWeekTrack } from "./releaseWeeks";

const track = (isrc: string, release_date: string | null, prev_streams: number | null = 10, cur_streams: number | null = 20): ReleaseWeekTrack => ({ isrc, name: isrc, artist_names: ["Artist"], release_date, prev_streams, cur_streams, reset_drop: null, reset_run_date: null, run_date: "2026-11-05" });
describe("release week grouping", () => {
  it.each([["2026-10-16", "2026-10-16"], ["2026-10-22", "2026-10-16"], ["2026-10-17", "2026-10-16"], ["2026-10-18", "2026-10-16"], ["2026-10-21", "2026-10-16"]])("maps %s to Friday %s", (date, friday) => expect(releaseWeekStart(date)).toBe(friday));
  it("places boundary releases in weekly, monthly, yearly and unknown buckets", () => {
    const result = groupReleaseWeeks([track("weekly", "2026-08-07"), track("monthly", "2026-08-06"), track("old-month", "2025-08-01"), track("year", "2025-07-31"), track("unknown", null)], "2026-11-03");
    expect(result.buckets.map(b => [b.kind, b.label])).toEqual([["week", "Week of Fri 7 Aug 2026"], ["month", "Aug 2026"], ["month", "Aug 2025"], ["year", "2025"], ["unknown", "Unknown"]]);
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
