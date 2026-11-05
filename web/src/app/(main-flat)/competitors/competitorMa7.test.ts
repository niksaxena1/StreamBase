import { describe, expect, it } from "vitest";

import { buildMa7WeekRows, smoothLabelSeriesMa7, trailingMean7 } from "./competitorMa7";
import type { LabelDailyPoint } from "./competitorsTypes";

function pt(label_key: string, date: string, v: number): LabelDailyPoint {
  return { date, label_key, daily_streams_net: v, total_streams_cumulative: 0, track_count: 1 };
}

function day(n: number): string {
  return `2026-01-${String(n).padStart(2, "0")}`;
}

function run(label: string, from: number, to: number, f: (n: number) => number) {
  const out: LabelDailyPoint[] = [];
  for (let n = from; n <= to; n++) out.push(pt(label, day(n), f(n)));
  return out;
}

describe("trailingMean7", () => {
  it("is null until 5 non-null values are in the window", () => {
    const out = trailingMean7([10, 10, 10, 10, 10, 10, 10, 10]);
    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBe(10);
    expect(out[7]).toBe(10);
  });

  it("ignores nulls inside the window", () => {
    const out = trailingMean7([10, null, 20, 30, 40, 50, 60]);
    expect(out[6]).toBe(35); // 210 / 6
    expect(trailingMean7([1, null, null, 1, 1, 1])[5]).toBeNull(); // only 4 present
  });
});

describe("smoothLabelSeriesMa7", () => {
  it("treats a missing calendar day as null, not skipped", () => {
    const series = [...run("a", 1, 3, () => 10), ...run("a", 5, 8, () => 20)]; // day 4 missing
    const out = smoothLabelSeriesMa7(series);
    const byDate = Object.fromEntries(out.map((p) => [p.date, p.daily_streams_net]));
    expect(byDate[day(4)]).toBeUndefined();
    expect(byDate[day(1)]).toBeUndefined(); // too few days yet
    expect(byDate[day(5)]).toBeUndefined(); // only 4 present days in window
    expect(byDate[day(6)]).toBe(70 / 5);
    expect(byDate[day(8)]).toBe(100 / 6);
  });
});

describe("buildMa7WeekRows", () => {
  const own = "__own_catalog__";
  const series = [
    ...run(own, 1, 14, (n) => (n <= 7 ? 100 : 150)),
    ...run("a", 1, 14, (n) => (n <= 7 ? 200 : 180)),
    ...run("b", 1, 14, (n) => (n <= 7 ? 50 : 100)),
    ...run("short", 12, 14, () => 10),
  ];
  const rows = buildMa7WeekRows(series, [own, "a", "b", "short"]);
  const by = Object.fromEntries(rows.map((r) => [r.labelKey, r]));

  it("computes means and pct", () => {
    expect(by[own].ma7Now).toBe(150);
    expect(by[own].ma7Prev).toBe(100);
    expect(by[own].pct).toBeCloseTo(0.5);
    expect(by.a.pct).toBeCloseTo(-0.1);
    expect(by.b.pct).toBeCloseTo(1);
  });

  it("computes vs ours in points and null for own", () => {
    expect(by[own].vsOursPts).toBeNull();
    expect(by.a.vsOursPts).toBeCloseTo(-60);
    expect(by.b.vsOursPts).toBeCloseTo(50);
  });

  it("gives nulls for a label with too few days", () => {
    expect(by.short).toEqual({ labelKey: "short", ma7Now: null, ma7Prev: null, pct: null, vsOursPts: null });
  });
});

describe("bucketLabelSeriesWeekly", () => {
  it("sums ISO weeks and drops an incomplete latest week", async () => {
    const { bucketLabelSeriesWeekly } = await import("./competitorMa7");
    // 2026-01-05 is a Monday; 05..11 = W02 complete, 12..14 = part of W03 (dropped).
    const rows = run("a", 5, 14, () => 10).map((p, i) => ({ ...p, track_count: 100 + i }));
    const out = bucketLabelSeriesWeekly(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "2026-W02", collector: "a", daily_streams_net: 70, track_count: 6 });
  });
  it("keeps the latest week when it ends on a Sunday", async () => {
    const { bucketLabelSeriesWeekly } = await import("./competitorMa7");
    const out = bucketLabelSeriesWeekly([...run("a", 5, 11, () => 1), ...run("b", 5, 11, () => 2)]);
    expect(out.map((r) => [r.collector, r.daily_streams_net])).toEqual([["a", 7], ["b", 14]]);
  });
});

describe("bucketLabelSeriesWeekly edges", () => {
  it("drops a part first week", async () => {
    const { bucketLabelSeriesWeekly } = await import("./competitorMa7");
    // 2026-01-03 is a Saturday (W01 part), 05..11 = W02.
    const out = bucketLabelSeriesWeekly(run("a", 3, 11, () => 1));
    expect(out.map((r) => r.date)).toEqual(["2026-W02"]);
  });
});
