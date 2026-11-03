import { describe, expect, it } from "vitest";

import {
  buildCombinedSeries,
  buildCompareRows,
  combinedToHistory,
  computeTotals,
  effectiveStatusFilter,
  filterRowsByStatus,
  formatGrowthPercent,
  growingWithoutAds,
  growthPercent,
  normalizeSelection,
  normalizeStatusFilter,
  parseStatusUpdates,
  resolveSelection,
  rowsForSelection,
  rowsForView,
  statusCounts,
  statusMapForSelection,
  unassignedPlaylistIds,
  validateCollectionName,
  visibleCollections,
  type AdStatus,
  type PlaylistWatchCollection,
} from "./collectionsModel";
import { effectiveSort, nextSortOnClick, type PlaylistWatchRow } from "./playlistWatchClientModel";

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
  return {
    id,
    name: id,
    color: null,
    sortOrder,
    playlistIds,
    members: playlistIds.map((playlistId) => ({ playlistId, adStatus: null, adStatusChangedAt: null })),
  };
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

function colWithStatus(
  id: string,
  members: Array<[string, AdStatus | null] | [string, AdStatus | null, string]>,
  sortOrder = 0,
): PlaylistWatchCollection {
  return {
    id,
    name: id,
    color: null,
    sortOrder,
    playlistIds: members.map(([playlistId]) => playlistId),
    members: members.map(([playlistId, adStatus, changedAt]) => ({
      playlistId,
      adStatus,
      adStatusChangedAt: (changedAt as string | undefined) ?? null,
    })),
  };
}

describe("ad status resolution", () => {
  const cols = [
    colWithStatus("A", [["p1", "live", "2026-10-01T00:00:00Z"], ["p2", "stopped", "2026-10-05T00:00:00Z"], ["p3", null]], 1),
    colWithStatus("B", [["p1", "stopped", "2026-10-09T00:00:00Z"], ["p2", "stopped", "2026-10-07T00:00:00Z"], ["p4", "live"]], 2),
  ];

  it("uses the membership status inside a collection", () => {
    const a = statusMapForSelection(cols, "A");
    expect(a.get("p1")?.status).toBe("live");
    expect(a.get("p2")).toEqual({ status: "stopped", changedAt: "2026-10-05T00:00:00Z" });
    expect(a.has("p3")).toBe(false);
    expect(a.has("p4")).toBe(false);
    expect(statusMapForSelection(cols, "B").get("p1")?.status).toBe("stopped");
  });

  it("under All: live in any collection wins, else stopped (latest stop date), else none", () => {
    const all = statusMapForSelection(cols, "all");
    expect(all.get("p1")?.status).toBe("live"); // live in A, stopped in B
    expect(all.get("p2")).toEqual({ status: "stopped", changedAt: "2026-10-07T00:00:00Z" });
    expect(all.get("p4")?.status).toBe("live");
    expect(all.has("p3")).toBe(false);
  });

  it("has no statuses under Unassigned and ignores the switch there", () => {
    expect(statusMapForSelection(cols, "unassigned").size).toBe(0);
    expect(effectiveStatusFilter("live", "unassigned")).toBe("all");
    expect(effectiveStatusFilter("live", "A")).toBe("live");
  });

  it("normalises the status filter, unknown values to all", () => {
    expect(normalizeStatusFilter("live")).toBe("live");
    expect(normalizeStatusFilter("stopped")).toBe("stopped");
    expect(normalizeStatusFilter("nope")).toBe("all");
    expect(normalizeStatusFilter(null)).toBe("all");
  });
});

describe("status filtering, counts and compare rows", () => {
  const rows = [
    row("p1", [["2026-10-27", 100], ["2026-10-28", 110]], { delta7d: 10 }),
    row("p2", [["2026-10-27", 200], ["2026-10-28", 220]], { delta7d: 20 }),
    row("p3", [["2026-10-27", 300], ["2026-10-28", 300]], { delta7d: 0 }),
    row("p4", [["2026-10-27", 50], ["2026-10-28", 60]], { delta7d: 10, watchStatus: "archived" }),
  ];
  const cols = [
    colWithStatus("A", [["p1", "live"], ["p2", "stopped"], ["p3", null], ["p4", "stopped"]], 1),
    colWithStatus("B", [["p1", "stopped"]], 2),
    colWithStatus("Empty", [], 3),
  ];
  const ids = (list: PlaylistWatchRow[]) => list.map((r) => r.spotifyPlaylistId);

  it("filters by status inside a collection and excludes playlists without a status", () => {
    expect(ids(rowsForView(rows, cols, "A", "live"))).toEqual(["p1"]);
    expect(ids(rowsForView(rows, cols, "A", "stopped"))).toEqual(["p2"]); // archived p4 never counts
    expect(ids(rowsForView(rows, cols, "A", "all"))).toEqual(["p1", "p2", "p3"]);
    expect(ids(rowsForView(rows, cols, "all", "stopped"))).toEqual(["p2"]); // p1 is live in A
    expect(ids(rowsForView(rows, cols, "B", "stopped"))).toEqual(["p1"]);
    expect(ids(filterRowsByStatus(rows, cols, "unassigned", "live"))).toEqual(ids(rows));
  });

  it("counts segments for the chip", () => {
    expect(statusCounts(rows, cols, "A")).toEqual({ all: 3, live: 1, stopped: 1 });
    expect(statusCounts(rows, cols, "all")).toEqual({ all: 3, live: 1, stopped: 1 });
    expect(statusCounts(rows, cols, "B")).toEqual({ all: 1, live: 0, stopped: 1 });
  });

  it("applies the status filter per collection in compare rows", () => {
    const out = buildCompareRows(rows, cols, "stopped");
    expect(out.map((r) => [r.id, r.playlistCount])).toEqual([["A", 1], ["B", 1], ["Empty", 0]]);
    expect(buildCompareRows(rows, cols, "live").map((r) => r.playlistCount)).toEqual([1, 0, 0]);
  });

  it("hides empty collections and falls back to All for them", () => {
    expect(visibleCollections(rows, cols).map((c) => c.id)).toEqual(["A", "B"]);
    // A collection whose only members are archived is empty for display purposes.
    const archivedOnly = [colWithStatus("Z", [["p4", null]])];
    expect(visibleCollections(rows, archivedOnly)).toEqual([]);
    expect(resolveSelection("Empty", rows, cols)).toBe("all");
    expect(resolveSelection("A", rows, cols)).toBe("A");
    // Every live playlist is in some collection here, so Unassigned has nothing to show.
    expect(resolveSelection("unassigned", rows, cols)).toBe("all");
  });
});

describe("Growing without ads", () => {
  it("counts stopped playlists with a positive 7d change and sums the gain", () => {
    const stopped = [
      row("a", [["2026-10-28", 1]], { delta7d: 412 }),
      row("b", [["2026-10-28", 1]], { delta7d: 8 }),
      row("c", [["2026-10-28", 1]], { delta7d: 0 }),
      row("d", [["2026-10-28", 1]], { delta7d: -30 }),
      row("e", [["2026-10-28", 1]], { delta7d: null }),
    ];
    expect(growingWithoutAds(stopped)).toEqual({ count: 2, gain7d: 420 });
    expect(growingWithoutAds([])).toEqual({ count: 0, gain7d: 0 });
  });
});

describe("percent growth", () => {
  it("is delta over (followers - delta)", () => {
    expect(growthPercent(34_400, 412)).toBeCloseTo((412 / 33_988) * 100, 6);
    expect(formatGrowthPercent(growthPercent(34_400, 412))).toBe("+1.2%");
    expect(formatGrowthPercent(growthPercent(900, -100))).toBe("-10.0%");
  });

  it("is omitted when the base is not positive or inputs are missing", () => {
    expect(growthPercent(100, 100)).toBeNull(); // base 0 (new playlist)
    expect(growthPercent(100, 150)).toBeNull(); // negative base
    expect(growthPercent(100, null)).toBeNull();
    expect(growthPercent(null, 10)).toBeNull();
    expect(formatGrowthPercent(null)).toBeNull();
  });

  it("shows zero without a sign", () => {
    expect(formatGrowthPercent(growthPercent(500, 0))).toBe("0.0%");
    expect(formatGrowthPercent(0.01)).toBe("0.0%");
  });
});

describe("default sort", () => {
  it("defaults to 7d desc in the Stopped view and followers desc otherwise", () => {
    expect(effectiveSort(null, "stopped")).toEqual({ key: "delta7d", dir: "desc" });
    expect(effectiveSort(null, "all")).toEqual({ key: "followers", dir: "desc" });
    expect(effectiveSort(null, "live")).toEqual({ key: "followers", dir: "desc" });
  });

  it("an explicit pick always wins, and clicking flips or switches direction", () => {
    const picked = { key: "followers", dir: "asc" } as const;
    expect(effectiveSort(picked, "stopped")).toEqual(picked);
    // Clicking the column currently shown by default flips it.
    expect(nextSortOnClick(effectiveSort(null, "stopped"), "delta7d")).toEqual({ key: "delta7d", dir: "asc" });
    expect(nextSortOnClick(effectiveSort(null, "stopped"), "followers")).toEqual({ key: "followers", dir: "desc" });
  });
});

describe("parseStatusUpdates", () => {
  const id = "37i9dQZF1DXcBWIGoYBM5M";
  it("accepts valid entries, null clears, and collapses duplicates to the last", () => {
    expect(parseStatusUpdates(undefined)).toEqual([]);
    expect(
      parseStatusUpdates([
        { playlist: id, ad_status: "live" },
        { playlist: `spotify:playlist:${id}`, ad_status: null },
      ]),
    ).toEqual([{ playlistId: id, adStatus: null }]);
    expect(parseStatusUpdates([{ playlist: id, ad_status: "stopped" }])).toEqual([{ playlistId: id, adStatus: "stopped" }]);
  });

  it("rejects malformed input", () => {
    expect(parseStatusUpdates("live")).toBeNull();
    expect(parseStatusUpdates([{ playlist: "short", ad_status: "live" }])).toBeNull();
    expect(parseStatusUpdates([{ playlist: id, ad_status: "paused" }])).toBeNull();
    expect(parseStatusUpdates([{ playlist: id }])).toBeNull(); // a missing ad_status is not a clear
    expect(parseStatusUpdates([{ playlist: 5, ad_status: "live" }])).toBeNull();
    expect(parseStatusUpdates([null])).toBeNull();
    expect(parseStatusUpdates(Array.from({ length: 501 }, () => ({ playlist: id, ad_status: "live" })))).toBeNull();
  });
});
