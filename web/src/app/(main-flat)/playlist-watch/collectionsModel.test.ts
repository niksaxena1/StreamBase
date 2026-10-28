import { describe, expect, it } from "vitest";

import {
  buildCombinedSeries,
  buildCompareRows,
  combinedToHistory,
  computeTotals,
  normalizeSelection,
  rowsForSelection,
  unassignedPlaylistIds,
  validateCollectionName,
  type PlaylistWatchCollection,
} from "./collectionsModel";
import type { PlaylistWatchRow } from "./playlistWatchClientModel";

function row(
  id: string,
  points: Array<[string, number]>,
  extra: Partial<PlaylistWatchRow> = {},
): PlaylistWatchRow {
  const history = points.map(([date, followers], i) => ({
    date,
    followers,
    dailyDelta: i === 0 ? null : followers - points[i - 1]![1],
  }));
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
    ...extra,
  };
}

function col(id: string, playlistIds: string[], sortOrder = 0): PlaylistWatchCollection {
  return { id, name: id, color: null, sortOrder, playlistIds };
}

describe("selection and unassigned", () => {
  const rows = [row("a", [["2026-10-01", 1]]), row("b", [["2026-10-01", 1]]), row("c", [["2026-10-01", 1]])];

  it("computes unassigned playlists and handles overlapping memberships", () => {
    const cols = [col("x", ["a", "b"]), col("y", ["b"])];
    expect([...unassignedPlaylistIds(rows, cols)]).toEqual(["c"]);
    expect(rowsForSelection(rows, cols, "x").map((r) => r.spotifyPlaylistId)).toEqual(["a", "b"]);
    expect(rowsForSelection(rows, cols, "y").map((r) => r.spotifyPlaylistId)).toEqual(["b"]);
    expect(rowsForSelection(rows, cols, "unassigned").map((r) => r.spotifyPlaylistId)).toEqual(["c"]);
    expect(rowsForSelection(rows, cols, "all")).toHaveLength(3);
  });

  it("ignores archived playlists and falls back to all for unknown ids", () => {
    const withArchived = [...rows, row("d", [["2026-10-01", 1]], { watchStatus: "archived" })];
    expect(rowsForSelection(withArchived, [], "all")).toHaveLength(3);
    expect(unassignedPlaylistIds(withArchived.filter((r) => r.watchStatus !== "archived"), [])).toEqual(new Set(["a", "b", "c"]));
    expect(normalizeSelection("gone", [col("x", [])])).toBe("all");
    expect(normalizeSelection("x", [col("x", [])])).toBe("x");
    expect(normalizeSelection("unassigned", [])).toBe("unassigned");
    expect(normalizeSelection(null, [])).toBe("all");
  });
});

describe("computeTotals", () => {
  it("sums followers, today (latest vs previous date) and deltas", () => {
    const rows = [
      row("a", [["2026-10-26", 100], ["2026-10-27", 110], ["2026-10-28", 130]], { delta7d: 50, delta30d: 80 }),
      row("b", [["2026-10-26", 200], ["2026-10-27", 190], ["2026-10-28", 185]], { delta7d: -20, delta30d: null }),
    ];
    const t = computeTotals(rows);
    expect(t.playlistCount).toBe(2);
    expect(t.followers).toBe(315);
    expect(t.today).toBe(20 + -5);
    expect(t.delta7d).toBe(30);
    expect(t.delta30d).toBe(80);
  });

  it("supports negative gains", () => {
    const rows = [row("a", [["2026-10-27", 500], ["2026-10-28", 450]])];
    expect(computeTotals(rows).today).toBe(-50);
  });

  it("skips playlists without both dates and returns null when nothing is known", () => {
    const rows = [
      row("a", [["2026-10-27", 100], ["2026-10-28", 120]]),
      row("new", [["2026-10-28", 999]]), // added to watch today: no previous snapshot
      row("stale", [["2026-10-27", 50]]), // missed today's check
    ];
    expect(computeTotals(rows).today).toBe(20);
    const lone = computeTotals([row("n", [["2026-10-28", 5]])]);
    expect(lone.today).toBeNull();
    expect(lone.delta7d).toBeNull();
    expect(computeTotals([])).toEqual({ playlistCount: 0, followers: null, today: null, delta7d: null, delta30d: null });
  });
});

describe("buildCombinedSeries", () => {
  it("sums follower counts per date", () => {
    const rows = [
      row("a", [["2026-10-26", 100], ["2026-10-27", 110]]),
      row("b", [["2026-10-26", 10], ["2026-10-27", 5]]),
    ];
    const s = buildCombinedSeries(rows);
    expect(s.map((p) => [p.date, p.total, p.gain])).toEqual([
      ["2026-10-26", 110, null],
      ["2026-10-27", 115, 5],
    ]);
  });

  it("drops dates where a live member has no snapshot (missing day)", () => {
    const rows = [
      row("a", [["2026-10-26", 100], ["2026-10-27", 110], ["2026-10-28", 120]]),
      row("b", [["2026-10-26", 10], ["2026-10-28", 30]]),
    ];
    const s = buildCombinedSeries(rows);
    expect(s.map((p) => p.date)).toEqual(["2026-10-26", "2026-10-28"]);
    expect(s[1]).toMatchObject({ total: 150, gain: 40 });
  });

  it("does not count a playlist added mid-range as growth, and handles negative gain", () => {
    const rows = [
      row("a", [["2026-10-26", 100], ["2026-10-27", 90], ["2026-10-28", 80]]),
      row("late", [["2026-10-28", 1000]]),
    ];
    const s = buildCombinedSeries(rows);
    expect(s.map((p) => [p.date, p.total, p.gain, p.playlistCount])).toEqual([
      ["2026-10-26", 100, null, 1],
      ["2026-10-27", 90, -10, 1],
      ["2026-10-28", 1080, -10, 2],
    ]);
    expect(combinedToHistory(s)[2]).toEqual({ date: "2026-10-28", followers: 1080, dailyDelta: -10 });
  });

  it("returns an empty series for no data", () => {
    expect(buildCombinedSeries([])).toEqual([]);
    expect(buildCombinedSeries([row("a", [])])).toEqual([]);
  });
});

describe("buildCompareRows", () => {
  it("returns one row per collection in sort order with overlapping members counted in both", () => {
    const rows = [
      row("a", [["2026-10-27", 100], ["2026-10-28", 110]]),
      row("b", [["2026-10-27", 10], ["2026-10-28", 12]]),
    ];
    const cols = [col("B", ["a", "b"], 2), col("A", ["b"], 1)];
    const out = buildCompareRows(rows, cols);
    expect(out.map((r) => r.id)).toEqual(["A", "B"]);
    expect(out[0]).toMatchObject({ playlistCount: 1, followers: 12, today: 2 });
    expect(out[1]).toMatchObject({ playlistCount: 2, followers: 122, today: 12 });
  });
});

describe("validateCollectionName", () => {
  it("trims and enforces length", () => {
    expect(validateCollectionName("  Ads · A  ")).toEqual({ ok: true, name: "Ads · A" });
    expect(validateCollectionName("   ").ok).toBe(false);
    expect(validateCollectionName("x".repeat(61)).ok).toBe(false);
    expect(validateCollectionName(5).ok).toBe(false);
  });
});
