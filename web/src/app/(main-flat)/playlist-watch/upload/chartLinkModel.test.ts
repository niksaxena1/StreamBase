import { describe, expect, it } from "vitest";

import {
  bestPositionByTrack,
  candidateToRow,
  cellsByTrack,
  dedupeCandidates,
  movementOf,
  normalizeCandidates,
  normalizeChartPositions,
  sortCandidates,
  type ChartCandidate,
  type ChartPositionRow,
} from "./chartLinkModel";
import { growthFor } from "./uploadTracksModel";

function pos(over: Partial<ChartPositionRow>): ChartPositionRow {
  return {
    spotifyTrackId: "t1",
    chartKey: "th",
    chartName: "Tech House",
    latestChartDate: "2026-11-04",
    position: 10,
    positionRefFriday: 10,
    refFriday: "2026-10-30",
    bestPosition: 10,
    daysOnChart: 5,
    firstChartDate: "2026-10-01",
    ...over,
  };
}

function cand(over: Partial<ChartCandidate>): ChartCandidate {
  return {
    chartKey: "th",
    chartName: "Tech House",
    chartDate: "2026-11-04",
    position: 5,
    positionRefFriday: null,
    refFriday: "2026-10-30",
    bestPosition: 5,
    daysOnChart: 1,
    isrc: "ISRC1",
    name: "Track",
    mixName: null,
    artists: "A",
    labelName: null,
    releaseDate: null,
    bpm: null,
    camelot: null,
    imageUrl: null,
    beatportUrl: null,
    spotifyTrackId: null,
    removedFromUploadDate: null,
    latestDate: null,
    latestPlaycount: null,
    playcount1d: null,
    playcount7d: null,
    history: [],
    ...over,
  };
}

describe("movementOf", () => {
  it("up, down, same, new, off", () => {
    expect(movementOf(17, 23)).toEqual({ kind: "up", delta: 6 });
    expect(movementOf(26, 23)).toEqual({ kind: "down", delta: 3 });
    expect(movementOf(23, 23)).toEqual({ kind: "same" });
    expect(movementOf(23, null)).toEqual({ kind: "new" });
    expect(movementOf(null, 12)).toEqual({ kind: "off" });
  });
});

describe("bestPositionByTrack", () => {
  it("picks the lowest current position across charts and merges best rank", () => {
    const m = bestPositionByTrack([
      pos({ chartKey: "a", chartName: "A", position: 30, bestPosition: 20 }),
      pos({ chartKey: "b", chartName: "B", position: 8, bestPosition: 8 }),
    ]);
    const r = m.get("t1")!;
    expect(r.chartName).toBe("B");
    expect(r.position).toBe(8);
    expect(r.bestPosition).toBe(8);
  });

  it("prefers a charted row over an off-chart one, and the best past rank when all are off", () => {
    expect(
      bestPositionByTrack([pos({ chartName: "A", position: null, bestPosition: 3 }), pos({ chartName: "B", position: 50 })]).get("t1")!.chartName,
    ).toBe("B");
    const off = bestPositionByTrack([
      pos({ chartName: "A", position: null, bestPosition: 12 }),
      pos({ chartName: "B", position: null, bestPosition: 4 }),
    ]).get("t1")!;
    expect(off.chartName).toBe("B");
    expect(off.position).toBeNull();
    expect(cellsByTrack([pos({ position: null, bestPosition: 4 })]).get("t1")!.movement).toEqual({ kind: "off" });
  });

  it("normalizes string numerics", () => {
    const rows = normalizeChartPositions([{ spotify_track_id: "x", chart_key: "k", position: "7", position_ref_friday: null, best_position: "3" }]);
    expect(rows[0].position).toBe(7);
    expect(rows[0].positionRefFriday).toBeNull();
    expect(rows[0].bestPosition).toBe(3);
  });
});

describe("candidate adapter", () => {
  it("normalizes bigints and history", () => {
    const [c] = normalizeCandidates([{ isrc: "I", latest_playcount: "123456", history: [["2026-11-01", "5"]], release_date: "2026-10-31" }]);
    expect(c.latestPlaycount).toBe(123456);
    expect(c.history).toEqual([["2026-11-01", 5]]);
  });

  it("released after the reference Friday gets baseline 0 for Since Fri", () => {
    const row = candidateToRow(
      cand({
        releaseDate: "2026-10-31",
        latestDate: "2026-11-04",
        latestPlaycount: 5000,
        history: [
          ["2026-11-02", 2000],
          ["2026-11-04", 5000],
        ],
      }),
    );
    expect(growthFor(row, "fri", "2026-10-30")).toBe(5000);
  });

  it("older release uses history baseline; 28d and added are null", () => {
    const row = candidateToRow(
      cand({
        releaseDate: "2025-01-01",
        latestDate: "2026-11-04",
        latestPlaycount: 5000,
        history: [
          ["2026-10-29", 4000],
          ["2026-11-04", 5000],
        ],
      }),
    );
    expect(growthFor(row, "fri", "2026-10-30")).toBe(1000);
    expect(growthFor(row, "28d", "2026-10-30")).toBeNull();
    expect(growthFor(row, "added", "2026-10-30")).toBeNull();
  });
});

describe("sortCandidates", () => {
  const list = [
    cand({ isrc: "a", name: "A", position: 3, latestPlaycount: null }),
    cand({ isrc: "b", name: "B", position: 1, latestPlaycount: 100 }),
    cand({ isrc: "c", name: "C", position: 2, latestPlaycount: 500 }),
  ];
  it("rank ascending", () => {
    expect(sortCandidates(list, "rank", "asc", "fri", "abs", null).map((c) => c.isrc)).toEqual(["b", "c", "a"]);
  });
  it("plays keeps nulls last in both directions", () => {
    expect(sortCandidates(list, "plays", "desc", "fri", "abs", null).map((c) => c.isrc)).toEqual(["c", "b", "a"]);
    expect(sortCandidates(list, "plays", "asc", "fri", "abs", null).map((c) => c.isrc)).toEqual(["b", "c", "a"]);
  });
  it("release date sorts nulls last", () => {
    const l = [cand({ isrc: "x", releaseDate: null }), cand({ isrc: "y", releaseDate: "2026-10-01" })];
    expect(sortCandidates(l, "release", "desc", "fri", "abs", null).map((c) => c.isrc)).toEqual(["y", "x"]);
  });
  it("dedupes by ISRC keeping the best position", () => {
    const d = dedupeCandidates([cand({ chartKey: "a", position: 9 }), cand({ chartKey: "b", position: 4 })]);
    expect(d).toHaveLength(1);
    expect(d[0].chartKey).toBe("b");
  });
});
