import { describe, expect, it } from "vitest";

import { buildFollowerHistory } from "@/lib/playlistWatch/history";
import { getDemoFollowerSnapshots, PLAYLIST_WATCH_DEMO_PLAYLIST_ID } from "@/lib/playlistWatch/demoPlaylist";

describe("playlist watch demo snapshots", () => {
  it("includes negative day-over-day follower deltas", () => {
    const history = buildFollowerHistory(getDemoFollowerSnapshots());
    const negativeDays = history.filter((row) => row.dailyDelta !== null && row.dailyDelta < 0);
    expect(negativeDays.length).toBeGreaterThanOrEqual(3);
    expect(negativeDays.some((row) => row.date === "2026-05-10")).toBe(true);
  });

  it("keeps latest totals aligned with table headline deltas", () => {
    const snapshots = getDemoFollowerSnapshots();
    const history = buildFollowerHistory(snapshots);
    const latest = history[history.length - 1];
    expect(latest.followers).toBe(4280);
    expect(latest.dailyDelta).toBe(39);
    expect(latest.followers - (history.find((row) => row.date === "2026-05-15")?.followers ?? 0)).toBe(226);
    expect(snapshots[0]?.spotify_playlist_id).toBe(PLAYLIST_WATCH_DEMO_PLAYLIST_ID);
  });
});
