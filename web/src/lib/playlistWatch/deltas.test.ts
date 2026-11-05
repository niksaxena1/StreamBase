import { describe, expect, it } from "vitest";

import { deltaSince } from "@/lib/playlistWatch/deltas";

const rows = [
  { date: "2026-11-01", follower_count: 175469 },
  { date: "2026-11-02", follower_count: 175699 },
  { date: "2026-11-03", follower_count: 175925 },
  { date: "2026-11-04", follower_count: 176078 },
];

describe("deltaSince", () => {
  it("counts 1D from the newest snapshot, not from today, before the daily run", () => {
    // Today is 5 Nov but today's snapshot is not in yet: 1D is the 3 Nov -> 4 Nov change, not 0.
    expect(deltaSince(rows, 176078, 1, "2026-11-05")).toBe(153);
  });

  it("uses today's snapshot once it exists", () => {
    const withToday = [...rows, { date: "2026-11-05", follower_count: 176284 }];
    expect(deltaSince(withToday, 176284, 1, "2026-11-05")).toBe(206);
    expect(deltaSince(withToday, 176284, 3, "2026-11-05")).toBe(176284 - 175699);
  });

  it("returns null without enough history or a latest count", () => {
    expect(deltaSince(rows, 176078, 7, "2026-11-05")).toBeNull();
    expect(deltaSince(rows, null, 1, "2026-11-05")).toBeNull();
    expect(deltaSince([], 61, 1, "2026-11-05")).toBeNull();
  });
});
