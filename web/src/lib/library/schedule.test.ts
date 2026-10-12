import { describe, expect, it } from "vitest";

import { BUSY_WEEK_THRESHOLD, groupByWeek, weekFriday, weekLabel, weekStart } from "./schedule";
import { makeRow } from "./testRows";
import type { LibraryRow } from "./types";

// 2026-10-12 is a Monday.
const TODAY = "2026-10-14";
const at = (id: string, release_date: string | null, over: Partial<LibraryRow> = {}) =>
  makeRow({ catalog_id: id, release_date, ...over });

describe("week math", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-14")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // a Sunday belongs to the week that began on Monday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
  });
  it("names the week by its Friday", () => {
    expect(weekFriday("2026-10-19")).toBe("2026-10-23");
    expect(weekLabel("2026-10-19")).toBe("Fri 23 Oct 2026");
    expect(weekLabel("2026-10-23")).toBe("Fri 23 Oct 2026");
    expect(weekLabel("2026-10-25")).toBe("Fri 23 Oct 2026");
  });
  it("crosses month and year boundaries", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(weekLabel("2027-01-01")).toBe("Fri 1 Jan 2027");
  });
});

describe("groupByWeek", () => {
  it("groups by week with rows ordered by date then artist", () => {
    const rows = [
      at("C", "2026-10-23", { sheet_artist: "Zed" }),
      at("A", "2026-10-21", { sheet_artist: "Mina" }),
      at("B", "2026-10-21", { sheet_artist: "Abe" }),
    ];
    const { weeks } = groupByWeek(rows, TODAY);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].label).toBe("Fri 23 Oct 2026");
    expect(weeks[0].rows.map((r) => r.catalog_id)).toEqual(["B", "A", "C"]);
    expect(weeks[0].count).toBe(3);
  });

  it("hides weeks before the current one by default and counts them", () => {
    const rows = [at("old", "2026-09-01"), at("now", "2026-10-13"), at("later", "2026-10-30")];
    const hidden = groupByWeek(rows, TODAY);
    expect(hidden.hiddenPast).toBe(1);
    expect(hidden.weeks.flatMap((w) => w.rows.map((r) => r.catalog_id))).toEqual(["now", "later"]);
    const all = groupByWeek(rows, TODAY, { showPast: true });
    expect(all.hiddenPast).toBe(0);
    expect(all.weeks.flatMap((w) => w.rows.map((r) => r.catalog_id))).toEqual(["old", "now", "later"]);
  });

  it("marks the current week", () => {
    const { weeks } = groupByWeek([at("now", "2026-10-13"), at("next", "2026-10-20")], TODAY);
    expect(weeks.map((w) => w.current)).toEqual([true, false]);
  });

  it("fills empty weeks between dated ones", () => {
    const { weeks } = groupByWeek([at("a", "2026-10-13"), at("b", "2026-11-03")], TODAY);
    expect(weeks.map((w) => [w.label, w.count, w.empty])).toEqual([
      ["Fri 16 Oct 2026", 1, false],
      ["Fri 23 Oct 2026", 0, true],
      ["Fri 30 Oct 2026", 0, true],
      ["Fri 6 Nov 2026", 1, false],
    ]);
  });

  it("flags weeks above the busy threshold only", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => at(`R${i}`, "2026-10-14"));
    expect(groupByWeek(make(BUSY_WEEK_THRESHOLD), TODAY).weeks[0].busy).toBe(false);
    expect(groupByWeek(make(BUSY_WEEK_THRESHOLD + 1), TODAY).weeks[0].busy).toBe(true);
  });

  it("counts entities per week, biggest first, and finds the busiest week", () => {
    const rows = [
      at("1", "2026-10-13", { entity: "p" }),
      at("2", "2026-10-14", { entity: "tg" }),
      at("3", "2026-10-15", { entity: "tg" }),
      at("4", "2026-10-15", { entity: null }),
      at("5", "2026-10-20", { entity: "tg" }),
    ];
    const s = groupByWeek(rows, TODAY);
    expect(s.weeks[0].entities).toEqual([
      { code: "tg", count: 2 },
      { code: "p", count: 1 },
      { code: "unassigned", count: 1 },
    ]);
    expect(s.maxCount).toBe(4);
  });

  it("puts undated releases in their own group", () => {
    const s = groupByWeek(
      [at("x", null, { sheet_artist: "B" }), at("y", "not-a-date", { sheet_artist: "A" }), at("z", "2026-10-13")],
      TODAY,
    );
    expect(s.noDate.map((r) => r.catalog_id)).toEqual(["y", "x"]);
    expect(s.weeks).toHaveLength(1);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByWeek([], TODAY)).toEqual({ weeks: [], noDate: [], hiddenPast: 0, maxCount: 0 });
  });
});
