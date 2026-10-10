import { describe, expect, it } from "vitest";
import {
  milestoneMarkers,
  milestoneValue,
  monthBars,
  pickPoint,
  sparklineSeries,
  type LookupMonth,
  type Reading,
} from "./lookup";

describe("two-click selection on the chart", () => {
  const current = { from: "2025-03-01", to: "2025-03-31" };
  it("first click sets From, second sets To", () => {
    const one = pickPoint(null, "2025-03-05", current);
    expect(one).toEqual({ first: "2025-03-05", range: { from: "2025-03-05", to: "2025-03-31" } });
    const two = pickPoint(one.first, "2025-03-20", one.range);
    expect(two).toEqual({ first: null, range: { from: "2025-03-05", to: "2025-03-20" } });
  });
  it("swaps when the second click is earlier", () => {
    const one = pickPoint(null, "2025-03-20", current);
    const two = pickPoint(one.first, "2025-03-05", one.range);
    expect(two.range).toEqual({ from: "2025-03-05", to: "2025-03-20" });
    expect(two.first).toBeNull();
  });
  it("moves To up when the first click is after the current To, and handles the same day twice", () => {
    expect(pickPoint(null, "2025-04-10", current).range).toEqual({ from: "2025-04-10", to: "2025-04-10" });
    const one = pickPoint(null, "2025-03-10", current);
    expect(pickPoint(one.first, "2025-03-10", one.range).range).toEqual({ from: "2025-03-10", to: "2025-03-10" });
  });
  it("starts over after completing a pair", () => {
    let state = pickPoint(null, "2025-03-05", current);
    state = pickPoint(state.first, "2025-03-20", state.range);
    state = pickPoint(state.first, "2025-03-02", state.range);
    expect(state.first).toBe("2025-03-02");
    expect(state.range.from).toBe("2025-03-02");
  });
});

describe("milestone flags", () => {
  const daily = [
    { day: "2023-07-08", streams: 277518 },
    { day: "2023-08-13", streams: 300081 },
    { day: "2024-01-07", streams: 363779 },
  ];
  it("parses K/M labels", () => {
    expect([milestoneValue("100K"), milestoneValue("1.5M"), milestoneValue("2M"), milestoneValue("x")]).toEqual([
      100000, 1500000, 2000000, 0,
    ]);
  });
  it("makes one flag per date with the largest milestone as its label", () => {
    const markers = milestoneMarkers(
      [
        { day: "2023-07-08", milestone: "250K", play_count: 277518 },
        { day: "2023-07-08", milestone: "100K", play_count: 277518 },
        { day: "2023-07-08", milestone: "200K", play_count: 277518 },
        { day: "2023-08-13", milestone: "300K", play_count: 300081 },
      ],
      daily,
      "2023-07-08",
    );
    expect(markers.map((m) => [m.date, m.label, m.value])).toEqual([
      ["2023-07-08", "250K +2", 277518],
      ["2023-08-13", "300K", 300081],
    ]);
    expect(markers[0].text).toHaveLength(3);
    expect(markers[0].text[0]).toBe("Milestone 100K · 8 Jul 2023 · 277,518 streams (logged on the first tracked day)");
    expect(markers[1].text).toEqual(["Milestone 300K · 13 Aug 2023 · 300,081 streams"]);
  });
  it("sits on the latest earlier reading for dates between readings, first reading before tracking", () => {
    const markers = milestoneMarkers(
      [
        { day: "2023-12-01", milestone: "150K", play_count: 1 },
        { day: "2023-01-01", milestone: "100K", play_count: 2 },
      ],
      daily,
      "2023-07-08",
    );
    expect(markers.map((m) => [m.date, m.value])).toEqual([
      ["2023-01-01", 277518],
      ["2023-12-01", 300081],
    ]);
  });
  it("is empty without milestones or readings", () => {
    expect(milestoneMarkers([], daily, "2023-07-08")).toEqual([]);
    expect(milestoneMarkers([{ day: "2023-07-08", milestone: "1M", play_count: 1 }], [], "2023-07-08")[0].value).toBeNull();
  });
});

describe("30-day sparkline series", () => {
  it("covers the trailing 30 days ending at the last reading, gaps stay null", () => {
    const daily = [
      { day: "2025-03-01", delta: 5 },
      { day: "2025-03-29", delta: 7 },
      { day: "2025-03-30", delta: -3 },
      { day: "2025-03-31", delta: null },
    ];
    const values = sparklineSeries(daily);
    expect(values).toHaveLength(30);
    // the window is 2 Mar..31 Mar, so 1 Mar is outside it
    expect(values[0]).toBeNull();
    expect(values.slice(27)).toEqual([7, -3, null]);
    expect(values.filter((v) => v !== null)).toHaveLength(2);
  });
});

const reading = (requested: string, substituted = false): Reading => ({
  requested,
  used_day: requested,
  streams: 1,
  substituted,
  before_tracking: false,
});
const month = (m: string, extra: Partial<LookupMonth> = {}): LookupMonth => ({
  month: m,
  from: reading(m),
  to: reading(m),
  streams_in_month: 1000,
  end_total: 5000,
  partial_first_month: false,
  partial_last_month: false,
  resets: [],
  gap_days: 0,
  ...extra,
});
describe("monthly bars", () => {
  it("marks flagged months and the months inside the chosen dates", () => {
    const bars = monthBars(
      [
        month("2025-01-01", { partial_first_month: true }),
        month("2025-02-01"),
        month("2025-03-01", { gap_days: 3 }),
      ],
      { from: "2025-02-10", to: "2025-03-05" },
    );
    expect(bars.map((b) => [b.month, b.flagged, b.selected])).toEqual([
      ["2025-01-01", true, false],
      ["2025-02-01", false, true],
      ["2025-03-01", true, true],
    ]);
    expect(bars[2].flags).toEqual(["3 gap days"]);
    expect(bars[0].value).toBe(1000);
  });
});
