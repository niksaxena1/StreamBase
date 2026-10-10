import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  clampDay,
  dayStatus,
  inRanges,
  monthGrid,
  monthsBetween,
  parseTypedDate,
  stepRange,
} from "./calendar";
import {
  displayNumber,
  displaySigned,
  exactTitle,
  tooltipNumber,
} from "./format";
import {
  describeSwitch,
  launchHash,
  milestoneThresholds,
  monthFlags,
  ownMilestones,
  readingFlag,
  readLast,
  reportNotes,
  saveLast,
  sortReport,
  switchLines,
  switchWarnings,
  thresholdLabel,
  type LookupMonth,
  type ReportRow,
  type SourceSwitch,
} from "./lookup";
import { readNumberMode, writeNumberMode } from "./numberMode";
import { extractSpotifyId, rankPalette } from "./palette";
import { isTypingTarget, shortcutAction, type ShortcutEvent } from "./shortcuts";
import { windowTitle } from "./title";

function stubStorage(initial: Record<string, string> = {}, broken = false) {
  const data = { ...initial };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (broken) throw new Error("blocked");
      return k in data ? data[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("blocked");
      data[k] = v;
    },
    removeItem: (k: string) => delete data[k],
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  return data;
}
afterEach(() => vi.unstubAllGlobals());

describe("number display toggle", () => {
  it("formats exact and compact, always keeping the exact value reachable", () => {
    expect(displayNumber(1234567, 0, "exact")).toBe("1,234,567");
    expect(displayNumber(1234567, 0, "compact")).toBe("1.2M");
    expect(displayNumber(null, 0, "compact")).toBe("—");
    expect(displaySigned(369562, "compact")).toBe("+369.6K");
    expect(displaySigned(-1500, "exact")).toBe("−1,500");
    expect(exactTitle(1234567, 0, "compact")).toBe("1,234,567");
    expect(exactTitle(1234567, 0, "exact")).toBeUndefined();
    expect(tooltipNumber(1234567, 0, "compact")).toBe("1.2M · 1,234,567");
    expect(tooltipNumber(1234567, 0, "exact")).toBe("1,234,567");
  });
  it("persists the mode, defaults to exact and survives blocked storage", () => {
    stubStorage();
    expect(readNumberMode()).toBe("exact");
    writeNumberMode("compact");
    expect(readNumberMode()).toBe("compact");
    stubStorage({}, true);
    writeNumberMode("exact");
    expect(readNumberMode()).toBe("exact"); // memory fallback
    writeNumberMode("compact");
    expect(readNumberMode()).toBe("compact");
  });
});

describe("calendar", () => {
  it("steps days across month, year and leap boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-01-15", -2)).toBe("2024-11-15");
  });
  it("moves From/To one day while keeping From <= To inside the bounds", () => {
    const bounds = { from: "2025-01-01", to: "2025-12-22" };
    expect(
      stepRange({ from: "2025-02-28", to: "2025-03-31" }, "from", 1, bounds),
    ).toEqual({ from: "2025-03-01", to: "2025-03-31" });
    expect(
      stepRange({ from: "2025-03-01", to: "2025-03-31" }, "to", 1, bounds),
    ).toEqual({ from: "2025-03-01", to: "2025-04-01" });
    // cannot cross the other end
    expect(
      stepRange({ from: "2025-03-31", to: "2025-03-31" }, "from", 1, bounds),
    ).toBeNull();
    expect(
      stepRange({ from: "2025-03-31", to: "2025-03-31" }, "to", -1, bounds),
    ).toBeNull();
    // cannot leave the tracked dates
    expect(
      stepRange({ from: "2025-01-01", to: "2025-03-31" }, "from", -1, bounds),
    ).toBeNull();
    expect(
      stepRange({ from: "2025-01-01", to: "2025-12-22" }, "to", 1, bounds),
    ).toBeNull();
  });
  it("marks reading, gap and outside days", () => {
    const bounds = { from: "2025-03-01", to: "2025-03-31" };
    const ranges = [
      ["2025-03-01", "2025-03-09"],
      ["2025-03-17", "2025-03-31"],
    ] as const;
    expect(dayStatus("2025-03-05", bounds, ranges)).toBe("reading");
    expect(dayStatus("2025-03-10", bounds, ranges)).toBe("gap");
    expect(dayStatus("2025-03-16", bounds, ranges)).toBe("gap");
    expect(dayStatus("2025-03-17", bounds, ranges)).toBe("reading");
    expect(dayStatus("2025-02-28", bounds, ranges)).toBe("outside");
    expect(dayStatus("2025-04-01", bounds, ranges)).toBe("outside");
    expect(dayStatus("2025-03-10", bounds)).toBe("reading"); // no availability data
    expect(inRanges("2025-03-09", ranges)).toBe(true);
    expect(inRanges("2025-03-12", ranges)).toBe(false);
    expect(clampDay("2020-01-01", bounds)).toBe(bounds.from);
  });
  it("lays out Monday-first weeks and lists months newest first", () => {
    const march = monthGrid(2025, 2);
    expect(march[0][0]).toBe("2025-02-24"); // 1 Mar 2025 is a Saturday
    expect(march[0][5]).toBe("2025-03-01");
    expect(march.every((week) => week.length === 7)).toBe(true);
    expect(monthGrid(2024, 1).flat()).toContain("2024-02-29");
    expect(monthsBetween({ from: "2024-11-05", to: "2025-02-01" })).toEqual([
      "2025-02",
      "2025-01",
      "2024-12",
      "2024-11",
    ]);
  });
  it("accepts only real typed dates", () => {
    expect(parseTypedDate(" 2025-03-10 ")).toBe("2025-03-10");
    expect(parseTypedDate("2025-02-30")).toBeNull();
    expect(parseTypedDate("10/03/2025")).toBeNull();
    expect(parseTypedDate("")).toBeNull();
  });
});

const key = (partial: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: "",
  code: "",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: "BODY" } as unknown as EventTarget,
  ...partial,
});
describe("lookup keyboard shortcuts", () => {
  it("maps the documented keys", () => {
    expect(shortcutAction(key({ key: "/" }))).toBe("focus-artist");
    expect(shortcutAction(key({ key: "t" }))).toBe("focus-track");
    expect(shortcutAction(key({ key: "c" }))).toBe("copy");
    expect(shortcutAction(key({ key: "?", shiftKey: true }))).toBe("help");
    expect(shortcutAction(key({ key: "[", code: "BracketLeft" }))).toBe("from-back");
    expect(shortcutAction(key({ key: "]", code: "BracketRight" }))).toBe("from-forward");
    // Shift+[ is "{" on US layouts: matched by code, not key
    expect(
      shortcutAction(key({ key: "{", code: "BracketLeft", shiftKey: true })),
    ).toBe("to-back");
    expect(
      shortcutAction(key({ key: "}", code: "BracketRight", shiftKey: true })),
    ).toBe("to-forward");
    expect(shortcutAction(key({ key: "x" }))).toBeNull();
  });
  it("ignores typing targets, dialogs, modifiers and auto-repeat", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"])
      expect(
        shortcutAction(key({ key: "t", target: { tagName: tag } as unknown as EventTarget })),
      ).toBeNull();
    const combobox = {
      tagName: "DIV",
      getAttribute: (n: string) => (n === "role" ? "combobox" : null),
    } as unknown as EventTarget;
    expect(isTypingTarget(combobox)).toBe(true);
    expect(shortcutAction(key({ key: "c", target: combobox }))).toBeNull();
    expect(
      shortcutAction(
        key({ key: "[", code: "BracketLeft", target: { tagName: "INPUT" } as unknown as EventTarget }),
      ),
    ).toBeNull();
    expect(
      shortcutAction(
        key({ key: "x", target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget }),
      ),
    ).toBeNull();
    expect(shortcutAction(key({ key: "c" }), true)).toBeNull(); // a dialog is open
    expect(shortcutAction(key({ key: "c", ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key({ key: "c", metaKey: true }))).toBeNull();
    expect(shortcutAction(key({ key: "/", repeat: true }))).toBeNull();
    expect(shortcutAction(key({ key: "c", defaultPrevented: true }))).toBeNull();
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("quick jump ranking", () => {
  const track = (isrc: string, song_name: string, artist: string, streams = 0) => ({
    isrc,
    song_name,
    artist,
    latest_streams: streams,
  });
  const tracks = [
    track("A1", "Midnight Dreams", "Zed", 900),
    track("A2", "Dreams", "Joongle", 100),
    track("A3", "Dreamer", "Joongle", 500),
    track("A4", "Lucid", "Dreamy Co", 50),
    track("A5", "Ørn", "Nøway", 10),
    track("SE6QE2204745", "Other", "Joongle", 5),
  ];
  const artists = [
    { name: "Dreamy Co", track_count: 3 },
    { name: "Joongle", track_count: 260 },
    { name: "Nøway", track_count: 12 },
  ];
  it("puts exact and prefix matches first, then word-prefix and contains", () => {
    const order = rankPalette("dream", tracks, artists).map((i) =>
      i.kind === "track" ? i.track.song_name : `artist:${i.artist.name}`,
    );
    expect(order.slice(0, 3)).toEqual(["Dreamer", "Dreams", "artist:Dreamy Co"]);
    expect(order.indexOf("Midnight Dreams")).toBeGreaterThan(order.indexOf("Dreams"));
    // an artist-name prefix ("Dreamy Co") outranks a mid-title word match ("Midnight Dreams")
    expect(order.indexOf("Lucid")).toBeLessThan(order.indexOf("Midnight Dreams"));
  });
  it("is accent and case insensitive and matches ISRCs and artists", () => {
    const first = rankPalette("NOWAY", tracks, artists)[0];
    expect(first.kind === "artist" && first.artist.name).toBe("Nøway");
    expect(
      rankPalette("se6qe2204745", tracks, artists)[0],
    ).toMatchObject({ kind: "track", track: { isrc: "SE6QE2204745" } });
    expect(rankPalette("  ", tracks, artists)).toEqual([]);
    // candidates the server matched by Spotify ID/combined text stay (lowest tier); artists need a name match
    const unmatched = rankPalette("zzzz", tracks, artists);
    expect(unmatched.every((i) => i.kind === "track" && i.tier === 8)).toBe(true);
  });
  it("breaks ties by streams and honours the limits", () => {
    const many = Array.from({ length: 20 }, (_, i) => track(`X${i}`, `Song ${i}`, "A", i));
    const ranked = rankPalette("song", many, [], { tracks: 5, artists: 2 });
    expect(ranked).toHaveLength(5);
    expect(ranked[0].kind === "track" && ranked[0].track.isrc).toBe("X19");
  });
  it("extracts Spotify IDs from links, URIs and bare IDs", () => {
    const id = "5p3RtNFDn8DjwdNXd6Flph";
    expect(extractSpotifyId(id)).toBe(id);
    expect(extractSpotifyId(`https://open.spotify.com/track/${id}?si=abc`)).toBe(id);
    expect(extractSpotifyId(`spotify:track:${id}`)).toBe(id);
    expect(extractSpotifyId("Dreams")).toBeNull();
  });
});

const sw = (day: string, jump: number): SourceSwitch => ({
  day,
  from_id: "a",
  to_id: "b",
  jump,
});
describe("counter-source switches", () => {
  it("explains a notable switch in one clear sentence", () => {
    const text = describeSwitch(sw("2025-07-17", 363323));
    expect(text).toContain("On 17 Jul 2025");
    expect(text).toContain("switched to another Spotify release with a higher count (+363,323 in one day)");
    expect(text).toContain("includes that jump, not just streams earned");
    expect(describeSwitch(sw("2025-07-17", -5000))).toContain("lower count (−5,000 in one day)");
  });
  it("warns about notable switches, summarises many and counts minor ones", () => {
    expect(switchWarnings(undefined).lines).toEqual([]);
    const minorOnly = switchWarnings([sw("2025-01-01", 180), sw("2025-01-02", -90)]);
    expect(minorOnly.lines).toEqual([]);
    expect(minorOnly.minor).toBe(2);
    const one = switchWarnings([sw("2025-01-01", 180), sw("2025-07-17", 363323)]);
    expect(one.lines).toHaveLength(1);
    expect(one.minor).toBe(1);
    const many = switchWarnings([
      sw("2025-01-01", 2000),
      sw("2025-02-01", 9000),
      sw("2025-03-01", 4000),
    ]);
    expect(many.lines).toHaveLength(1);
    expect(many.lines[0]).toContain("3 counter-source switches");
    expect(many.lines[0]).toContain("largest +9,000 on 1 Feb 2025");
  });
  it("draws chart lines only for notable switches, largest ones when capped", () => {
    expect(switchLines([sw("2025-01-01", 50)])).toEqual([]);
    const lines = switchLines(
      Array.from({ length: 20 }, (_, i) =>
        sw(`2025-01-${String(i + 1).padStart(2, "0")}`, 1000 + i),
      ),
      5,
    );
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.date)).toEqual([...lines.map((l) => l.date)].sort());
    expect(lines[0].text).toContain("Counter source switched");
  });
  it("flags months and report rows that contain a notable switch", () => {
    const month = {
      month: "2025-07-01",
      from: { requested: "2025-06-30", used_day: "2025-06-30", streams: 1, substituted: false, before_tracking: false },
      to: { requested: "2025-07-31", used_day: "2025-07-31", streams: 2, substituted: false, before_tracking: false },
      streams_in_month: 1,
      end_total: 2,
      partial_first_month: false,
      partial_last_month: false,
      resets: [],
      gap_days: 0,
      source_switches: [sw("2025-07-17", 363323)],
    } as LookupMonth;
    expect(monthFlags(month).map((f) => f.label)).toContain("Counter source switch");
    expect(monthFlags({ ...month, source_switches: [] }).map((f) => f.label)).not.toContain("Counter source switch");
    const notes = reportNotes({ empty: false, resets: [], gap_days: 0, source_switches: [sw("2025-07-17", 363323)] });
    expect(notes.map((n) => n.label)).toEqual(["source switch"]);
  });
});

describe("milestones from the track's own series", () => {
  it("lists the owner's thresholds then every further 5M", () => {
    const list = milestoneThresholds(31e6);
    expect(list.slice(0, 5)).toEqual([1e5, 1.5e5, 2e5, 2.5e5, 3e5]);
    expect(list).toContain(7.5e5);
    expect(list).not.toContain(1.2e6);
    expect(list.slice(-5)).toEqual([1e7, 1.5e7, 2e7, 2.5e7, 3e7]);
    expect(milestoneThresholds(99999)).toEqual([]);
    expect(thresholdLabel(1.5e5)).toBe("150K");
    expect(thresholdLabel(1.5e6)).toBe("1.5M");
    expect(thresholdLabel(1e7)).toBe("10M");
  });
  it("flags the first day at or above each threshold, on the line", () => {
    const daily = [
      { day: "2025-01-01", streams: 90000 },
      { day: "2025-01-02", streams: 99999 },
      { day: "2025-01-03", streams: 100000 },
      { day: "2025-01-04", streams: 260000 },
      { day: "2025-01-05", streams: 200000 }, // counter fell: never flagged again
      { day: "2025-01-06", streams: 310000 },
    ];
    const { markers, alreadyPast } = ownMilestones(daily);
    expect(alreadyPast).toEqual([]);
    expect(markers.map((m) => [m.date, m.label, m.value])).toEqual([
      ["2025-01-03", "100K", 100000],
      ["2025-01-04", "250K +2", 260000], // 150K, 200K, 250K all first reached on the same day
      ["2025-01-06", "300K", 310000],
    ]);
    for (const marker of markers)
      expect(daily.find((d) => d.day === marker.date)?.streams).toBe(marker.value);
  });
  it("notes thresholds already past at the first reading instead of flagging them", () => {
    const { markers, alreadyPast } = ownMilestones([
      { day: "2025-01-01", streams: 260000 },
      { day: "2025-01-02", streams: 410000 },
    ]);
    expect(alreadyPast).toEqual(["100K", "150K", "200K", "250K"]);
    expect(markers.map((m) => m.label)).toEqual(["400K +1"]);
    expect(ownMilestones([])).toEqual({ markers: [], alreadyPast: [] });
  });
});

describe("remembering the last lookup", () => {
  it("round-trips, validates and tolerates blocked storage", () => {
    stubStorage();
    expect(readLast()).toBeNull();
    saveLast({ dataset: "stats2", isrc: "SE6QE2204745", from: "2025-03-01", to: "2025-03-31" });
    expect(readLast()).toEqual({ dataset: "stats2", isrc: "SE6QE2204745", from: "2025-03-01", to: "2025-03-31" });
    stubStorage({ "streambase-legacy-lookup-last": '{"isrc":"X","dataset":"followers","from":"2025-01-01","to":"2025-01-02"}' });
    expect(readLast()).toBeNull();
    stubStorage({ "streambase-legacy-lookup-last": "not json" });
    expect(readLast()).toBeNull();
    stubStorage({}, true);
    expect(readLast()).toBeNull();
    expect(() => saveLast({ dataset: "stats", isrc: "A", from: "2025-01-01", to: "2025-01-02" })).not.toThrow();
  });
  it("opens the last lookup only when the hash is empty", () => {
    const last = { dataset: "stats" as const, isrc: "SE6QE2204745", from: "2025-03-01", to: "2025-03-31" };
    expect(launchHash("", last)).toBe(
      "#/lookup?isrc=SE6QE2204745&dataset=stats&from=2025-03-01&to=2025-03-31",
    );
    expect(launchHash("#/", last)).toContain("#/lookup?");
    expect(launchHash("#/tracks?dataset=stats2", last)).toBeNull();
    expect(launchHash("", null)).toBeNull();
  });
});

describe("artist report helpers", () => {
  const reading = (streams: number, extra = {}) => ({
    requested: "2025-03-01",
    used_day: "2025-03-01",
    streams,
    substituted: false,
    before_tracking: false,
    ...extra,
  });
  const row = (isrc: string, title: string, from: number, to: number, diff: number | null): ReportRow =>
    ({
      track: { isrc, song_name: title, artist: "A", first_day: "2025-01-01", last_day: "2025-12-01", latest_streams: to },
      from: reading(from),
      to: reading(to),
      difference: diff,
      days: 30,
      per_day: diff === null ? null : diff / 30,
      resets: [],
      gap_days: 0,
      empty: diff === null,
      source_switches: [],
    }) as ReportRow;
  const rows = [row("B", "beta", 10, 30, 20), row("A", "Alpha", 5, 6, 1), row("C", "gamma", 0, 0, null)];
  it("sorts by any column with missing values last", () => {
    expect(sortReport(rows, "difference", "desc").map((r) => r.track.isrc)).toEqual(["B", "A", "C"]);
    expect(sortReport(rows, "difference", "asc").map((r) => r.track.isrc)).toEqual(["A", "B", "C"]);
    expect(sortReport(rows, "title", "asc").map((r) => r.track.song_name)).toEqual(["Alpha", "beta", "gamma"]);
    expect(sortReport(rows, "from", "desc").map((r) => r.track.isrc)).toEqual(["B", "A", "C"]);
  });
  it("flags substituted readings and explains notes", () => {
    expect(readingFlag(reading(1))).toBeNull();
    expect(readingFlag(reading(1, { substituted: true, used_day: "2025-02-28" }))).toMatchObject({ label: "used 28 Feb 2025" });
    expect(readingFlag(reading(1, { substituted: true, before_tracking: true }))?.label).toBe("before tracking");
    expect(reportNotes({ empty: true, resets: ["2025-03-05"], gap_days: 3, source_switches: [] }).map((n) => n.label)).toEqual([
      "no reading in range",
      "1 reset",
      "3 gap days",
    ]);
  });
});

describe("window titles", () => {
  it("builds page-specific titles ending in Legacy Archive", () => {
    expect(windowTitle("Dreams — Joongle")).toBe("Dreams — Joongle · Legacy Archive");
    expect(windowTitle()).toBe("Legacy Archive");
    expect(windowTitle("", null, "Tracks")).toBe("Tracks · Legacy Archive");
  });
});
