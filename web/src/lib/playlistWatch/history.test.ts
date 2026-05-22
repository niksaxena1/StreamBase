import { describe, expect, it } from "vitest";

import { buildFollowerHistory } from "@/lib/playlistWatch/history";

describe("buildFollowerHistory", () => {
  it("sorts snapshots and adds day-over-day deltas", () => {
    expect(
      buildFollowerHistory([
        { date: "2026-05-22", follower_count: 110 },
        { date: "2026-05-20", follower_count: 100 },
        { date: "2026-05-21", follower_count: 104 },
      ]),
    ).toEqual([
      { date: "2026-05-20", followers: 100, dailyDelta: null },
      { date: "2026-05-21", followers: 104, dailyDelta: 4 },
      { date: "2026-05-22", followers: 110, dailyDelta: 6 },
    ]);
  });
});
