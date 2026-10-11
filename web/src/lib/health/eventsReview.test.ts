import { describe, expect, it } from "vitest";
import { addDaysISO } from "@/lib/sotDates";
import { assembleHealthEvents, dailyTotalsFromRpc, detectLargeMovements, eventDataDate, eventDateLabel, eventSnapshotWindow, eventWindow, type DailyTotal, type MembershipEventRow } from "./events";

const daily = (values: number[]): DailyTotal[] => values.map((streams, i) => ({
  date: addDaysISO("2026-10-01", i), streams, tracks_counted: 100, tracks_expected: 100,
}));

describe("Health movement coverage", () => {
  it("labels an incomplete day rather than alerting on its artificial drop", () => {
    const rows = daily([100, 100, 100, 100, 100, 100, 100, 10]);
    rows[7].tracks_counted = 89;
    const events = detectLargeMovements(rows, "2026-10-08", "2026-10-08");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "partial_data", count: 89 });
    expect(events[0].description).toContain("89 of 100 expected tracks");
  });
  it("accepts exactly 90% coverage and rejects even slightly lower coverage", () => {
    const rows = daily([100, 100, 100, 100, 100, 100, 100, 136]);
    rows[7].tracks_counted = 90;
    expect(detectLargeMovements(rows, "2026-10-08", "2026-10-08")[0].type).toBe("movement");
    rows[7].tracks_expected = 101;
    expect(detectLargeMovements(rows, "2026-10-08", "2026-10-08")[0].type).toBe("partial_data");
  });
  it("uses the previous seven complete observations across a partial day", () => {
    const rows = daily([100, 100, 100, 100, 100, 100, 100, 9999, 136]);
    rows[7].tracks_counted = 1;
    const events = detectLargeMovements([...rows].reverse(), "2026-10-08", "2026-10-09");
    expect(events.map((e) => e.type)).toEqual(["partial_data", "movement"]);
    expect(events[1].description).toContain("+36.0%");
    expect(detectLargeMovements(rows, "2026-10-09", "2026-10-09")).toHaveLength(1);
  });
  it("requires seven complete observations, including when earlier data is partial", () => {
    const rows = daily([100, 100, 100, 100, 100, 100, 100, 136]);
    rows[2].tracks_counted = 89;
    expect(detectLargeMovements(rows, "2026-10-08", "2026-10-08")).toEqual([]);
  });
  it("distinguishes a missing current day from no prior catalog observations", () => {
    expect(detectLargeMovements([{ date: "2026-10-08", streams: 0, tracks_counted: 0, tracks_expected: 100 }], "2026-10-08", "2026-10-08")[0].type).toBe("partial_data");
    expect(detectLargeMovements([{ date: "2026-10-08", streams: 0, tracks_counted: 0, tracks_expected: 0 }], "2026-10-08", "2026-10-08")).toEqual([]);
  });
  it("normalizes bigint RPC responses without losing coverage counts", () => {
    expect(dailyTotalsFromRpc([{ date: "2026-10-08", daily_streams: "200", tracks_counted: 90, tracks_expected: 100 }])).toEqual([
      { date: "2026-10-08", streams: 200, tracks_counted: 90, tracks_expected: 100 },
    ]);
  });
});

describe("Health event date semantics", () => {
  it("labels lagged snapshots as data dates and ingestion explicitly as run dates", () => {
    for (const type of ["movement", "partial_data", "playlist_add", "playlist_remove", "new_track", "override"] as const) {
      expect(eventDateLabel({ type, date: "2026-10-11" })).toBe("2026-10-09");
    }
    expect(eventDateLabel({ type: "ingestion", date: "2026-10-11" })).toBe("run 2026-10-11");
    expect(eventDateLabel({ type: "takedown", date: "2026-10-11T23:00:00Z" })).toBe("2026-10-11");
    expect(eventDateLabel({ type: "restoration", date: "2026-10-11T23:00:00Z" })).toBe("2026-10-11");
  });
  it("dates removal after the last active day, including both window boundaries", () => {
    const window = eventWindow(7, "2026-10-11");
    const snapshots = eventSnapshotWindow(window);
    const row = (id: number, valid_to: string | null): MembershipEventRow => ({ id, playlist_key: "p", isrc: String(id), valid_from: "2026-10-01", valid_to, tracks: null });
    const events = assembleHealthEvents({ window, newTracks: [], additions: [], playlists: [], overrides: [], runs: [], dailyTotals: [], removals: [
      row(1, addDaysISO(snapshots.start, -1)), row(2, addDaysISO(snapshots.end, -1)),
      row(3, addDaysISO(snapshots.start, -2)), row(4, snapshots.end), row(5, null),
    ] });
    expect(events).toHaveLength(2);
    expect(events.map(eventDataDate)).toEqual([window.end, window.start]);
    expect(events.map((e) => e.date)).toEqual([snapshots.end, snapshots.start]);
  });
  it("sorts mixed events by their displayed date", () => {
    const window = eventWindow(7, "2026-10-11");
    const events = assembleHealthEvents({ window, additions: [], removals: [], playlists: [], overrides: [], dailyTotals: [],
      newTracks: [{ isrc: "A", name: "A", first_seen: "2026-10-12" }],
      availability: [{ id: 1, isrc: "B", event: "taken_down", detected_at: "2026-10-11T02:00:00Z", suppressed_reason: null, tracks: null }],
      runs: [{ id: 1, run_date: "2026-10-09", status: "success", logs_url: null }],
    });
    expect(events.map((e) => e.type)).toEqual(["takedown", "new_track", "ingestion"]);
    expect(events.map(eventDataDate)).toEqual(["2026-10-11", "2026-10-10", "2026-10-09"]);
  });
});
