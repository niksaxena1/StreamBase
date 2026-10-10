import { describe, expect, it } from "vitest";
import {
  clampRange,
  copyResult,
  lookupWarnings,
  monthRange,
  presetRange,
  selectPoints,
  type Between,
} from "./lookup";
const bounds = { from: "2023-10-19", to: "2025-12-22" };
const result: Between = {
  track: { artist: "Joongle", song_name: "Dreams", isrc: "SE6QE2204745" },
  from: {
    requested: "2025-03-01",
    used_day: "2025-03-01",
    streams: 201940,
    substituted: false,
    before_tracking: false,
  },
  to: {
    requested: "2025-03-31",
    used_day: "2025-03-31",
    streams: 219315,
    substituted: false,
    before_tracking: false,
  },
  difference: 17375,
  days: 30,
  per_day: 17375 / 30,
  resets: [],
  gap_days: 0,
  empty: false,
};
describe("UTC lookup ranges", () => {
  it("uses elapsed days anchored to the last archived reading", () => {
    expect(presetRange("Last 7 days", bounds)).toEqual({
      from: "2025-12-15",
      to: "2025-12-22",
    });
    expect(presetRange("Last 30 days", bounds)).toEqual({
      from: "2025-11-22",
      to: "2025-12-22",
    });
    expect(presetRange("Whole history", bounds)).toEqual(bounds);
    expect(presetRange("Previous month", bounds)).toEqual({
      from: "2025-11-01",
      to: "2025-11-30",
    });
  });
  it("handles leap February, regular February, and year boundaries", () => {
    expect(monthRange("2024-02")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(monthRange("2025-02")).toEqual({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(
      presetRange("Previous month", { from: "2023-01-01", to: "2024-03-15" }),
    ).toEqual(monthRange("2024-02"));
    expect(
      presetRange("Previous month", { from: "2023-01-01", to: "2024-01-15" }),
    ).toEqual(monthRange("2023-12"));
  });
  it("bounds short histories and partial months", () => {
    const short = { from: "2025-12-20", to: "2025-12-22" };
    expect(presetRange("Last 30 days", short)).toEqual(short);
    expect(clampRange(monthRange("2025-12"), short)).toEqual(short);
    expect(presetRange("Previous month", short)).toEqual({
      from: short.from,
      to: short.from,
    });
  });
  it("orders two clicks and a reversed drag, including identical points", () => {
    expect(selectPoints("2025-03-31", "2025-03-01")).toEqual(
      monthRange("2025-03"),
    );
    expect(selectPoints("2025-03-01", "2025-03-31")).toEqual(
      monthRange("2025-03"),
    );
    expect(selectPoints("2025-03-01", "2025-03-01")).toEqual({
      from: "2025-03-01",
      to: "2025-03-01",
    });
  });
});
it("formats the owner copy example exactly", () => {
  expect(copyResult(result)).toBe(
    "Joongle – Dreams (SE6QE2204745): 201,940 on 1 Mar 2025 → 219,315 on 31 Mar 2025 = +17,375 streams",
  );
  expect(copyResult({ ...result, difference: -12 })).toContain("= −12 streams");
  expect(copyResult({ ...result, difference: null, empty: true })).toBe("");
});
it("explains substitutions in copied text", () => {
  expect(
    copyResult({
      ...result,
      from: { ...result.from!, used_day: "2025-02-28", substituted: true },
    }),
  ).toContain("on 28 Feb 2025 (requested 1 Mar 2025)");
});
it("generates plain warnings for substitution, pre-tracking, reset, and gaps", () => {
  expect(lookupWarnings(result)).toEqual([]);
  const warnings = lookupWarnings({
    ...result,
    from: { ...result.from!, used_day: "2025-02-28", substituted: true },
    to: {
      ...result.to!,
      used_day: "2025-04-01",
      substituted: true,
      before_tracking: true,
    },
    resets: ["2025-03-05"],
    gap_days: 7,
  });
  expect(warnings).toEqual([
    "No reading on 1 Mar 2025 — using 28 Feb 2025.",
    "Not tracked yet on 31 Mar 2025 — using the first reading on 1 Apr 2025.",
    "Counter reset on 5 Mar 2025 inside this range. The difference includes this reset.",
    "7 days without readings inside this range (doesn't change the difference).",
  ]);
});
it("handles missing endpoints, duplicate warnings, and zero elapsed days", () => {
  expect(
    lookupWarnings({ ...result, from: null, to: null, empty: true }),
  ).toEqual([]);
  expect(lookupWarnings({ ...result, days: 0 })).toContain(
    "Both dates use the same reading; per day is unavailable because 0 days elapsed.",
  );
});
