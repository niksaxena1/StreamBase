import { describe, expect, it } from "vitest";

import {
  buildBenchmarkRows,
  buildCatalogInsights,
  buildRankRows,
  buildRosterMovement,
  buildShareRows,
  OUTSIDE_TRACKED_SET,
} from "./competitorWorkspaceAnalytics";
import type { LabelDailyPoint } from "./competitorsTypes";

const series: LabelDailyPoint[] = [
  { date: "2026-08-01", label_key: "a", daily_streams_net: 100, total_streams_cumulative: 1000, track_count: 10 },
  { date: "2026-08-01", label_key: "b", daily_streams_net: 300, total_streams_cumulative: 3000, track_count: 15 },
  { date: "2026-08-02", label_key: "a", daily_streams_net: 200, total_streams_cumulative: 1200, track_count: 10 },
  { date: "2026-08-02", label_key: "b", daily_streams_net: 200, total_streams_cumulative: 3200, track_count: 20 },
];

describe("competitor workspace series analytics", () => {
  it("builds deterministic ranks and shares", () => {
    const ranks = buildRankRows(series, ["a", "b"]);
    expect(ranks[0]).toMatchObject({ a: 2, b: 1 });
    expect(ranks[1]).toMatchObject({ a: 1, b: 2 });

    const shares = buildShareRows(series, ["a", "b"]);
    expect(shares[0]).toMatchObject({ a: 25, b: 75 });
    expect(shares[1]).toMatchObject({ a: 50, b: 50 });
  });

  it("keeps missing label-days out of ranks and benchmark lines", () => {
    const sparse = series.filter((point) => !(point.date === "2026-08-02" && point.label_key === "b"));
    const ranks = buildRankRows(sparse, ["a", "b"]);
    expect(ranks[1]).toMatchObject({ a: 1 });
    expect(ranks[1]).not.toHaveProperty("b");
    expect(buildBenchmarkRows(sparse, ["a", "b"], "indexed")[1].b).toBeNull();
  });

  it("supports absolute, indexed, and per-track benchmark modes", () => {
    expect(buildBenchmarkRows(series, ["a", "b"], "absolute")[1].a).toBe(200);
    expect(buildBenchmarkRows(series, ["a", "b"], "per_track")[1].b).toBe(10);
    expect(buildBenchmarkRows(series, ["a", "b"], "indexed")[0].a).toBeCloseTo(66.666, 2);
  });

  it("measures growth against competitor labels without folding own catalog into the median", () => {
    const ownAndPeers: LabelDailyPoint[] = [
      { date: "2026-08-01", label_key: "own", daily_streams_net: 100, total_streams_cumulative: 1000, track_count: 10 },
      { date: "2026-08-01", label_key: "a", daily_streams_net: 100, total_streams_cumulative: 1000, track_count: 10 },
      { date: "2026-08-01", label_key: "b", daily_streams_net: 100, total_streams_cumulative: 1000, track_count: 10 },
      { date: "2026-08-02", label_key: "own", daily_streams_net: 300, total_streams_cumulative: 1300, track_count: 10 },
      { date: "2026-08-02", label_key: "a", daily_streams_net: 200, total_streams_cumulative: 1200, track_count: 10 },
      { date: "2026-08-02", label_key: "b", daily_streams_net: 100, total_streams_cumulative: 1100, track_count: 10 },
    ];
    const rows = buildBenchmarkRows(ownAndPeers, ["own", "a", "b"], "median_growth", ["a", "b"]);
    expect(rows[1].own).toBeCloseTo(33.333, 2);
    expect(rows[1].a).toBeCloseTo(16.666, 2);
    expect(rows[1].b).toBeCloseTo(-16.666, 2);
    expect(rows[1].__median).toBe(0);
  });
});

describe("competitor roster movement", () => {
  it("pairs near-simultaneous removal and addition as a cross-label move", () => {
    const output = buildRosterMovement(
      [{ isrc: "X", label_key: "b", display_name: "Beta", event_date: "2026-08-04" }],
      [{ isrc: "X", label_key: "a", display_name: "Alpha", event_date: "2026-08-03" }],
      new Map([["X", { isrc: "X", name: "Track X", artist_names: ["Artist"], album_image_url: null }]]),
    );
    expect(output.flows).toEqual([{ source: "Alpha", target: "Beta", track_count: 1 }]);
    expect(output.movements[0]).toMatchObject({ name: "Track X", source: "Alpha", target: "Beta" });
  });

  it("keeps unmatched events connected to the outside tracked set", () => {
    const output = buildRosterMovement(
      [{ isrc: "Y", label_key: "a", display_name: "Alpha", event_date: "2026-08-05" }],
      [],
      new Map(),
    );
    expect(output.flows[0]).toEqual({ source: OUTSIDE_TRACKED_SET, target: "Alpha", track_count: 1 });
  });

  it("honours a wider pairing window for slow re-distributions", () => {
    const additions = [{ isrc: "Z", label_key: "emubands", display_name: "TG EmuBands", event_date: "2026-08-12" }];
    const removals = [{ isrc: "Z", label_key: "amuse", display_name: "TG Amuse", event_date: "2026-08-02" }];

    // 10-day gap: outside the default 3-day window …
    const defaultPairing = buildRosterMovement(additions, removals, new Map());
    expect(defaultPairing.flows).toContainEqual({ source: "TG Amuse", target: OUTSIDE_TRACKED_SET, track_count: 1 });

    // … but a single move when the caller allows takedown/processing gaps.
    const widePairing = buildRosterMovement(additions, removals, new Map(), 14);
    expect(widePairing.flows).toEqual([{ source: "TG Amuse", target: "TG EmuBands", track_count: 1 }]);
  });
});

describe("competitor catalog insights", () => {
  it("deduplicates a track shared by labels before artist and cohort aggregation", () => {
    const points = ["a", "b"].map((label_key) => ({
      isrc: "X",
      release_date: "2026-07-01",
      artist_ids: ["artist-1"],
      artist_names: ["Artist One"],
      album_image_url: null,
      total_streams_cumulative: 1000,
      daily_streams_delta: 100,
      label_key,
    }));
    const output = buildCatalogInsights(points, "2026-08-10");
    expect(output.artists[0]).toMatchObject({ track_count: 1, daily_streams: 100, label_keys: ["a", "b"] });
    expect(output.cohorts).toHaveLength(1);
    expect(output.cohorts[0]).toMatchObject({ track_count: 1, median_daily_streams: 100 });
  });
});
