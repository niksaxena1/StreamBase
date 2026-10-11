import { describe, expect, it } from "vitest";
import { assembleHealthEvents, detectLargeMovements, eventWindow, overrideNotePrefix, type DailyTotal, type MembershipEventRow } from "./events";
import { addDaysISO } from "@/lib/sotDates";

const window = eventWindow(30, "2026-10-11");
const track = { isrc: "A", name: "Track A", spotify_artist_ids: ["artist a"] };
const membership: MembershipEventRow = { id: 1, playlist_key: "list & one", isrc: "A", valid_from: "2026-10-10", valid_to: "2026-10-11", tracks: track };
const empty = { window, newTracks: [], additions: [], removals: [], playlists: [], overrides: [], runs: [], dailyTotals: [] };

describe("Health event assembly", () => {
  it("uses inclusive UTC day windows with bounded baseline context", () => {
    expect(window).toEqual({ start: "2026-09-12", end: "2026-10-11", until: "2026-10-12", streamsStart: "2026-09-04" });
    expect(eventWindow(7, "2026-01-03").start).toBe("2025-12-28");
    expect(eventWindow(90, "2026-10-11").start).toBe("2026-07-14");
  });

  it("groups distinct tracks by day, playlist and direction, including re-entry", () => {
    const other = { ...membership, id: 2, isrc: "B", tracks: null };
    const events = assembleHealthEvents({ ...empty,
      additions: [membership, membership, other, { ...membership, id: 3, valid_from: "2026-10-11" }, { ...membership, id: 4, playlist_key: "second" }],
      removals: [membership, other], playlists: [{ playlist_key: membership.playlist_key, display_name: "First playlist" }],
    });
    expect(events.filter((e) => e.type === "playlist_add")).toHaveLength(3);
    const group = events.find((e) => e.date === "2026-10-10" && e.count === 2)!;
    expect(group.description).toBe("Tracks added to First playlist");
    expect(group.href).toBe("/playlists?playlist_key=list%20%26%20one");
    expect(group.tracks).toEqual([
      { isrc: "A", name: "Track A", href: "/catalog?artist_id=artist+a&isrc=A" },
      { isrc: "B", name: "B", href: "/catalog" },
    ]);
    expect(events.find((e) => e.type === "playlist_remove")?.count).toBe(2);
  });

  it("keeps suppressed takedowns, restorations and failures, sorted newest first", () => {
    const events = assembleHealthEvents({ ...empty,
      availability: [
        { id: 1, isrc: "A", event: "taken_down", detected_at: "2026-10-10T18:00:00Z", suppressed_reason: "streambase_dead", tracks: track },
        { id: 2, isrc: "A", event: "restored", detected_at: "2026-10-11T01:00:00Z", suppressed_reason: null, tracks: track },
      ],
      newTracks: [{ ...track, first_seen: "2026-09-12" }, { ...track, isrc: "OLD", first_seen: "2026-09-11" }, { ...track, isrc: "FUTURE", first_seen: "2026-10-12" }],
      runs: [{ id: 4, run_date: "2026-10-11", status: "failed", logs_url: "https://example.com/logs" }],
    });
    expect(events.map((e) => e.type)).toEqual(["restoration", "ingestion", "takedown", "new_track"]);
    expect(events[2].description).toContain("already dead in StreamBase");
    expect(events[1]).toMatchObject({ failed: true, count: 1, href: "https://example.com/logs" });
    expect(events[0].description).toContain("restored on Spotify");
    expect(events[3].href).toContain("isrc=A");
  });

  it("groups override note prefixes by snapshot date and preserves providers", () => {
    const events = assembleHealthEvents({ ...empty, overrides: [
      { date: "2026-10-10", note: "auto-interp: gap 1" }, { date: "2026-10-10", note: "auto-interp: gap 2" },
      { date: "2026-10-11", note: "auto-interp: gap 1" },
      { date: "2026-10-10", note: "stale-fix: Beat Analytics auto" }, { date: "2026-10-10", note: "stale-fix: Music Metrics auto" },
      { date: "2026-10-10", note: "manual-interpolation: operator repair" }, { date: "2026-10-10", note: null },
    ] });
    expect(events).toHaveLength(6);
    expect(events.find((e) => e.date === "2026-10-10" && e.description.endsWith("auto-interp"))?.count).toBe(2);
    expect(overrideNotePrefix("stale-fix: Beat Analytics auto")).toBe("stale-fix: Beat Analytics");
    expect(overrideNotePrefix("  manual-interpolation: A  ")).toBe("manual-interpolation");
    expect(overrideNotePrefix(null)).toBe("manual override");
  });

  it("has deterministic tie ordering and no availability events without that own-only input", () => {
    const input = { ...empty, newTracks: [{ ...track, first_seen: "2026-10-11" }, { ...track, isrc: "B", first_seen: "2026-10-11" }] };
    expect(assembleHealthEvents(input)).toEqual(assembleHealthEvents({ ...input, newTracks: [...input.newTracks].reverse() }));
    expect(assembleHealthEvents(empty)).toEqual([]);
  });
});

describe("large daily movement detector", () => {
  const days = (values: Array<number | null>): DailyTotal[] => values.map((streams, i) => ({ date: addDaysISO("2026-10-01", i), streams }));
  it("detects rises and falls against the median, excluding the current day", () => {
    const totals = days([100, 100, 100, 100, 100, 100, 100, 136, 64]);
    const events = detectLargeMovements([...totals].reverse(), "2026-10-08", "2026-10-09");
    expect(events).toHaveLength(2);
    expect(events[0].description).toContain("+36.0%");
    expect(events[1].description).toContain("-36.0%");
  });
  it("excludes exact thresholds, nonfinite totals and zero/negative medians", () => {
    for (const value of [135, 65, 100, NaN, Infinity, null]) expect(detectLargeMovements(days([100, 100, 100, 100, 100, 100, 100, value]), "2026-10-08", "2026-10-08")).toEqual([]);
    for (const base of [0, -100]) expect(detectLargeMovements(days([base, base, base, base, base, base, base, 500]), "2026-10-08", "2026-10-08")).toEqual([]);
  });
  it("requires all seven calendar days and respects the output window", () => {
    const totals = days([100, 100, 100, 100, 100, 100, 100, 200]);
    expect(detectLargeMovements(totals.filter((_, i) => i !== 2), "2026-10-08", "2026-10-08")).toEqual([]);
    expect(detectLargeMovements(days([100, 100, null, 100, 100, 100, 100, 200]), "2026-10-08", "2026-10-08")).toEqual([]);
    expect(detectLargeMovements(totals, "2026-10-01", "2026-10-07")).toEqual([]);
  });
  it("uses a median so a single historical outlier does not distort the baseline", () => {
    expect(detectLargeMovements(days([100, 100, 10000, 100, 100, 100, 100, 136]), "2026-10-08", "2026-10-08")).toHaveLength(1);
  });
});
