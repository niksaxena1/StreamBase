import { describe, expect, it } from "vitest";

import {
  buildCombinedSeries,
  buildCompareRows,
  computeTotals,
  rowsForSelection,
  unassignedPlaylistIds,
  type PlaylistWatchCollection,
} from "@/app/(main-flat)/playlist-watch/collectionsModel";
import type { PlaylistWatchRow } from "@/app/(main-flat)/playlist-watch/playlistWatchClientModel";
import {
  excludeDemoPlaylists,
  getDemoFollowerSnapshots,
  getDemoLatestFollowerCount,
  isPlaylistWatchDemoModeEnabled,
  PLAYLIST_WATCH_DEMO_PLAYLIST_ID,
} from "@/lib/playlistWatch/demoPlaylist";
import { playlistWatchCacheKey } from "@/lib/playlistWatch/cache";
import { buildFollowerHistory } from "@/lib/playlistWatch/history";

const DEMO = PLAYLIST_WATCH_DEMO_PLAYLIST_ID;

function row(id: string, points: Array<[string, number]>): PlaylistWatchRow {
  const history = buildFollowerHistory(points.map(([date, follower_count]) => ({ date, follower_count })));
  return {
    spotifyPlaylistId: id,
    displayName: id,
    ownerSpotifyId: null,
    ownerName: null,
    spotifyUrl: null,
    imageUrl: null,
    watchStatus: "active",
    lastCheckStatus: "ok",
    lastCheckMessage: null,
    latestFollowerCount: points.at(-1)?.[1] ?? null,
    latestSnapshotDate: points.at(-1)?.[0] ?? null,
    latestCheckedAt: null,
    isFavorite: false,
    delta1d: null,
    delta7d: null,
    delta30d: null,
    history,
  };
}

function demoRow(): PlaylistWatchRow {
  const r = row(
    DEMO,
    getDemoFollowerSnapshots().map((s) => [s.date, s.follower_count] as [string, number]),
  );
  return { ...r, latestFollowerCount: getDemoLatestFollowerCount() };
}

function col(id: string, playlistIds: string[]): PlaylistWatchCollection {
  return {
    id,
    name: id,
    color: null,
    sortOrder: 0,
    playlistIds,
    members: playlistIds.map((playlistId) => ({ playlistId, adStatus: null, adStatusChangedAt: null })),
  };
}

/** What the loader does in production: one exclusion applied to rows and to collection members. */
function productionPageData(rows: PlaylistWatchRow[], collections: PlaylistWatchCollection[]) {
  const keptRows = excludeDemoPlaylists(rows, (r) => r.spotifyPlaylistId, false);
  const keptCollections = collections.map((c) => {
    const members = excludeDemoPlaylists(c.members, (m) => m.playlistId, false);
    return { ...c, members, playlistIds: members.map((m) => m.playlistId) };
  });
  return { rows: keptRows, collections: keptCollections };
}

const realA = row("realA", [["2026-11-01", 100], ["2026-11-02", 110], ["2026-11-03", 120]]);
const realB = row("realB", [["2026-11-01", 10], ["2026-11-02", 12], ["2026-11-03", 15]]);
const realLoose = row("realLoose", [["2026-11-01", 1], ["2026-11-02", 2], ["2026-11-03", 3]]);

describe("demo mode switch", () => {
  it("is off unless PLAYLIST_WATCH_DEMO=1, and never on the production deployment", () => {
    expect(isPlaylistWatchDemoModeEnabled({})).toBe(false);
    expect(isPlaylistWatchDemoModeEnabled({ PLAYLIST_WATCH_DEMO: "true" })).toBe(false);
    expect(isPlaylistWatchDemoModeEnabled({ PLAYLIST_WATCH_DEMO: "1" })).toBe(true);
    expect(isPlaylistWatchDemoModeEnabled({ PLAYLIST_WATCH_DEMO: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(isPlaylistWatchDemoModeEnabled({ PLAYLIST_WATCH_DEMO: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("uses separate cache entries for demo mode and retires the pre-fix entries", () => {
    const keys = [false, true].flatMap((archived) => [false, true].map((demo) => playlistWatchCacheKey(archived, demo)));
    expect(new Set(keys).size).toBe(4);
    expect(playlistWatchCacheKey(false)).toBe("playlist-watch-v2-active");
    expect(keys).not.toContain("playlist-watch-active");
    expect(keys).not.toContain("playlist-watch-all");
    expect(playlistWatchCacheKey(true, true)).toContain("demo");
  });

  it("keeps demo rows only when demo mode is on", () => {
    const rows = [realA, demoRow()];
    expect(excludeDemoPlaylists(rows, (r) => r.spotifyPlaylistId, true)).toHaveLength(2);
    expect(excludeDemoPlaylists(rows, (r) => r.spotifyPlaylistId, false).map((r) => r.spotifyPlaylistId)).toEqual(["realA"]);
  });
});

describe("production page data with a demo row in the database", () => {
  const input = {
    rows: [realA, realB, realLoose, demoRow()],
    collections: [col("DHH", ["realA", "realB"]), col("WithDemo", ["realB", DEMO])],
  };
  const page = productionPageData(input.rows, input.collections);

  it("drops the demo from counts, totals and history", () => {
    const totals = computeTotals(rowsForSelection(page.rows, page.collections, "all"));
    expect(totals.playlistCount).toBe(3);
    expect(totals.followers).toBe(120 + 15 + 3);
    expect(page.rows.some((r) => r.spotifyPlaylistId === DEMO)).toBe(false);
  });

  it("combined All chart reaches the latest real date instead of falling back to May", () => {
    const series = buildCombinedSeries(rowsForSelection(page.rows, page.collections, "all"));
    expect(series.map((p) => p.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(series.at(-1)).toMatchObject({ total: 138, playlistCount: 3 });
    // Without the exclusion, the demo's May-only history is what the chart showed live.
    const contaminated = buildCombinedSeries(input.rows);
    expect(contaminated.every((p) => p.date.startsWith("2026-05"))).toBe(true);
  });

  it("Unassigned, named collections and a collection that held the demo agree on their rows", () => {
    expect([...unassignedPlaylistIds(page.rows, page.collections)]).toEqual(["realLoose"]);
    const unassigned = rowsForSelection(page.rows, page.collections, "unassigned");
    expect(computeTotals(unassigned).playlistCount).toBe(1);
    expect(buildCombinedSeries(unassigned).at(-1)?.date).toBe("2026-11-03");

    const withDemo = page.collections.find((c) => c.id === "WithDemo")!;
    expect(withDemo.playlistIds).toEqual(["realB"]);
    const sel = rowsForSelection(page.rows, page.collections, "WithDemo");
    expect(sel.map((r) => r.spotifyPlaylistId)).toEqual(["realB"]);
    expect(buildCombinedSeries(sel).at(-1)).toMatchObject({ date: "2026-11-03", total: 15, playlistCount: 1 });

    const compare = buildCompareRows(page.rows, page.collections);
    const cmp = Object.fromEntries(compare.map((c) => [c.id, c]));
    expect(cmp.WithDemo.playlistCount).toBe(1);
    expect(cmp.DHH.playlistCount).toBe(2);
  });

  it("still drops a date when a real member is missing its snapshot", () => {
    const gap = row("gap", [["2026-11-01", 50], ["2026-11-03", 60]]);
    const p = productionPageData([realA, gap, demoRow()], []);
    const series = buildCombinedSeries(p.rows);
    expect(series.map((x) => x.date)).toEqual(["2026-11-01", "2026-11-03"]);
  });
});
