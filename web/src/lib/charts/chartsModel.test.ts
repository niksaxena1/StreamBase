import { describe, expect, it } from "vitest";

import {
  buildChartSummary,
  buildHistorySeries,
  buildLabelLeaderboard,
  movementBannerText,
  movementDisplay,
  parseCompareDays,
  parseIsoDate,
  remixText,
  type ChartDropoutRow,
  type ChartMovementRow,
} from "./chartsModel";

function row(over: Partial<ChartMovementRow>): ChartMovementRow {
  return {
    snapshot_date: "2026-10-28",
    compare_date: "2026-10-21",
    position: 1,
    source: "beatport",
    source_track_id: 1,
    name: "T",
    mix_name: null,
    artists: ["A"],
    remixers: [],
    label_name: "L1",
    release_date: null,
    bpm: 126,
    musical_key: null,
    camelot: null,
    image_url: null,
    track_url: null,
    isrc: null,
    prev_position: 1,
    position_change: 0,
    is_new: false,
    is_reentry: false,
    days_on_chart: 1,
    peak_position: 1,
    first_charted: "2026-10-01",
    ...over,
  };
}

describe("movementDisplay", () => {
  it("shows nothing without a comparison snapshot", () => {
    expect(movementDisplay(row({ is_new: true }), false)).toMatchObject({ kind: "none", text: "" });
  });
  it("formats up, down, unchanged, new and re-entry", () => {
    expect(movementDisplay(row({ position_change: 3 }), true)).toMatchObject({ kind: "up", text: "▲3" });
    expect(movementDisplay(row({ position_change: -2 }), true)).toMatchObject({ kind: "down", text: "▼2" });
    expect(movementDisplay(row({ position_change: 0 }), true)).toMatchObject({ kind: "same", text: "–" });
    expect(movementDisplay(row({ is_new: true, position_change: null }), true)).toMatchObject({ kind: "new", text: "NEW" });
    expect(movementDisplay(row({ is_reentry: true, position_change: null }), true)).toMatchObject({ kind: "re", text: "RE" });
  });
});

describe("label leaderboard", () => {
  it("ranks by spots and diffs against the reconstructed compare snapshot", () => {
    const rows = [
      row({ label_name: "A", prev_position: 4 }),
      row({ label_name: "A", prev_position: null, is_new: true }),
      row({ label_name: "A", prev_position: 9 }),
      row({ label_name: "B", prev_position: 2 }),
      row({ label_name: null, prev_position: null }),
    ];
    const dropouts = [{ label_name: "B" }, { label_name: "B" }, { label_name: "C" }];
    const lb = buildLabelLeaderboard(rows, dropouts, true);
    expect(lb[0]).toEqual({ label: "A", spots: 3, prevSpots: 2, change: 1 });
    expect(lb.find((l) => l.label === "B")).toEqual({ label: "B", spots: 1, prevSpots: 3, change: -2 });
    expect(lb.find((l) => l.label === "Unknown label")).toMatchObject({ spots: 1, prevSpots: 0, change: 1 });
    expect(lb.some((l) => l.label === "C")).toBe(false);
  });
  it("has no change columns without a comparison", () => {
    const lb = buildLabelLeaderboard([row({ label_name: "A" })], [], false);
    expect(lb).toEqual([{ label: "A", spots: 1, prevSpots: null, change: null }]);
  });
});

describe("buildChartSummary", () => {
  const rows = [
    row({ name: "Up", position_change: 5 }),
    row({ name: "Up2", position_change: 2 }),
    row({ name: "Down", position_change: -7 }),
    row({ name: "New", is_new: true, position_change: null, prev_position: null }),
    row({ name: "Re", is_reentry: true, position_change: null, prev_position: null }),
  ];
  const drops = [{} as ChartDropoutRow, {} as ChartDropoutRow];
  it("picks extremes and counts", () => {
    const s = buildChartSummary(rows, drops, true);
    expect(s.climber).toEqual({ name: "Up", change: 5 });
    expect(s.faller).toEqual({ name: "Down", change: -7 });
    expect(s).toMatchObject({ newCount: 1, reentryCount: 1, droppedCount: 2 });
    expect(s.topLabel).toEqual({ label: "L1", spots: 5 });
  });
  it("is empty without comparison but still has the top label", () => {
    const s = buildChartSummary(rows, [], false);
    expect(s).toMatchObject({ newCount: null, climber: null, faller: null, droppedCount: null });
    expect(s.topLabel?.label).toBe("L1");
  });
});

describe("misc helpers", () => {
  it("parses query params", () => {
    expect(parseCompareDays("1")).toBe(1);
    expect(parseCompareDays(undefined)).toBe(7);
    expect(parseCompareDays("30")).toBe(7);
    expect(parseIsoDate("2026-10-28")).toBe("2026-10-28");
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("nope")).toBeNull();
  });
  it("banner text pluralises", () => {
    expect(movementBannerText(7)).toBe("Movement appears once there is a snapshot 7 days older.");
    expect(movementBannerText(1)).toBe("Movement appears once there is a snapshot 1 day older.");
  });
  it("remixText", () => {
    expect(remixText(["X", "Y"])).toBe("remix: X, Y");
    expect(remixText([])).toBeNull();
  });
  it("history series leaves gaps and trims the leading empty days", () => {
    const s = buildHistorySeries(
      [
        { snapshot_date: "2026-10-26", position: 10 },
        { snapshot_date: "2026-10-28", position: 8 },
      ],
      "2026-10-28",
      90,
    );
    expect(s.map((p) => p.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(s.map((p) => p.position)).toEqual([10, null, 8]);
  });
});
