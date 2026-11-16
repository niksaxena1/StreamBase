import { describe, expect, test } from "vitest";

import {
  aggregateMonthlyDelta,
  applyStreamsBasis,
  buildCollectorMetricSeries,
  getEffectiveCollectorPlaylists,
  type CollectorPlaylistScopeRow,
} from "./collectorsUtils";
import type { CollectorSeriesPoint } from "./collectorsTypes";

function seriesPoint(
  date: string,
  streams: number,
  tracks: number,
  extras: Partial<CollectorSeriesPoint> & { partial?: boolean } = {},
): CollectorSeriesPoint {
  return {
    date,
    total_streams_cumulative: streams,
    track_count: tracks,
    daily_streams_net: 0,
    est_revenue_total: 0,
    est_revenue_daily_net: 0,
    ...extras,
  };
}

const playlists: CollectorPlaylistScopeRow[] = [
  {
    playlist_key: "tg_total",
    display_name: "TG Total",
    collector: null,
    spotify_playlist_image_url: "tg-total.jpg",
  },
  {
    playlist_key: "tg_distro_one",
    display_name: "TG Distro One",
    collector: "TG",
    spotify_playlist_image_url: "tg-one.jpg",
  },
  {
    playlist_key: "tg_distro_two",
    display_name: "TG Distro Two",
    collector: "TG",
    spotify_playlist_image_url: "tg-two.jpg",
  },
  {
    playlist_key: "p_total",
    display_name: "P Total",
    collector: null,
    spotify_playlist_image_url: "p-total.jpg",
  },
  {
    playlist_key: "pl_distro",
    display_name: "PL Distro",
    collector: "PL",
    spotify_playlist_image_url: "pl-distro.jpg",
  },
  {
    playlist_key: "a_distro",
    display_name: "A Distro",
    collector: "A",
    spotify_playlist_image_url: "a-distro.jpg",
  },
];

describe("getEffectiveCollectorPlaylists", () => {
  test("keeps assigned playlists when entity playlist totals are disabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "TG", false).map((p) => p.playlist_key)).toEqual([
      "tg_distro_one",
      "tg_distro_two",
    ]);
  });

  test("uses the total entity playlists for TG and PL when enabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "TG", true).map((p) => p.playlist_key)).toEqual(["tg_total"]);
    expect(getEffectiveCollectorPlaylists(playlists, "PL", true).map((p) => p.playlist_key)).toEqual(["p_total"]);
  });

  test("leaves other collectors on assigned playlists when enabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "A", true).map((p) => p.playlist_key)).toEqual(["a_distro"]);
  });
});

describe("gap-aware collector deltas", () => {
  test("calculates normal consecutive daily and monthly deltas", () => {
    const points = [seriesPoint("2026-01-03", 130, 12), seriesPoint("2026-01-02", 120, 11), seriesPoint("2026-01-01", 100, 10)];
    const daily = buildCollectorMetricSeries(points, 1).streams.daily;
    expect(daily.map((point) => [point.date, point.daily])).toEqual([
      ["2026-01-03", 10],
      ["2026-01-02", 20],
      ["2026-01-01", null],
    ]);
    expect(aggregateMonthlyDelta(points, "streams", 1)[0]).toMatchObject({
      month: "2026-01",
      value: 30,
      daysWithData: 2,
    });
  });

  test("skips a cumulative delta that spans a snapshot gap", () => {
    const points = [seriesPoint("2026-01-03", 130, 12), seriesPoint("2026-01-01", 100, 10)];
    const daily = buildCollectorMetricSeries(points, 1).streams.daily;
    expect(daily.map((point) => point.daily)).toEqual([null, null]);
    expect(aggregateMonthlyDelta(points, "streams", 1)[0]).toMatchObject({ month: "2026-01", value: 0 });
  });

  test("does not count the oldest track snapshot as a catalogue increase and preserves partial flag", () => {
    const points = [
      seriesPoint("2026-02-02", 120, 102),
      seriesPoint("2026-02-01", 110, 101),
      seriesPoint("2026-01-31", 100, 100, { partial: true }),
    ];
    const tracks = aggregateMonthlyDelta(points, "tracks", 1);
    expect(tracks.find((point) => point.month === "2026-01")).toMatchObject({ month: "2026-01", value: 0, partial: true });
    expect(tracks.find((point) => point.month === "2026-02")?.value).toBe(2);
  });
});

describe("streams basis (net / organic)", () => {
  test("applyStreamsBasis net is identity and organic substitutes with nulls preserved", () => {
    const row = {
      collector: "A",
      daily_streams_net: 30_000_000,
      est_revenue_daily_net: 100,
      daily_streams_delta_yday: 29_000_000,
      daily_streams_delta_ma7: null,
      est_revenue_daily_delta_yday: 5,
      est_revenue_daily_delta_ma7: 6,
      daily_streams_organic: 500_000,
      est_revenue_daily_organic: 2,
      daily_streams_organic_delta_yday: 10,
      daily_streams_organic_delta_ma7: null,
      est_revenue_daily_organic_delta_yday: null,
      est_revenue_daily_organic_delta_ma7: 0.5,
    };
    expect(applyStreamsBasis(row, "net")).toBe(row);
    const out = applyStreamsBasis(row, "organic");
    expect(out.collector).toBe("A");
    expect(out.daily_streams_net).toBe(500_000);
    expect(out.est_revenue_daily_net).toBe(2);
    expect(out.daily_streams_delta_yday).toBe(10);
    expect(out.daily_streams_delta_ma7).toBeNull();
    expect(out.est_revenue_daily_delta_yday).toBeNull();
    expect(out.est_revenue_daily_delta_ma7).toBe(0.5);
    // Original is not mutated.
    expect(row.daily_streams_net).toBe(30_000_000);
  });

  // Newest first. Cumulative jumps 30M on 2026-10-03 (a track moved in); organic daily is 500k.
  const jump: CollectorSeriesPoint[] = [
    seriesPoint("2026-10-03", 130_000_000, 12, { daily_streams_net: 500_000 }),
    seriesPoint("2026-10-02", 100_000_000, 11, { daily_streams_net: 400_000 }),
    seriesPoint("2026-10-01", 99_000_000, 10, { daily_streams_net: 300_000 }),
  ];

  test("aggregateMonthlyDelta: net unchanged, organic ignores the 30M jump", () => {
    const net = aggregateMonthlyDelta(jump, "streams", 0.004);
    expect(net[0].value).toBe(1_000_000 + 30_000_000);
    expect(aggregateMonthlyDelta(jump, "streams", 0.004, "net")).toEqual(net);

    const organic = aggregateMonthlyDelta(jump, "streams", 0.004, "organic");
    expect(organic[0].value).toBe(1_200_000);
    const organicRev = aggregateMonthlyDelta(jump, "revenue", 0.004, "organic");
    expect(organicRev[0].value).toBeCloseTo(1_200_000 * 0.004, 6);
    // Tracks are unaffected by basis.
    expect(aggregateMonthlyDelta(jump, "tracks", 0.004, "organic")).toEqual(
      aggregateMonthlyDelta(jump, "tracks", 0.004),
    );
  });

  test("buildCollectorMetricSeries: net unchanged, organic daily uses daily values", () => {
    const net = buildCollectorMetricSeries(jump, 0.004);
    expect(buildCollectorMetricSeries(jump, 0.004, "net")).toEqual(net);
    expect(net.streams.daily.find((p) => p.date === "2026-10-03")?.daily).toBe(30_000_000);

    const organic = buildCollectorMetricSeries(jump, 0.004, "organic");
    expect(organic.streams.daily.find((p) => p.date === "2026-10-03")?.daily).toBe(500_000);
    expect(organic.streams.daily.find((p) => p.date === "2026-10-01")?.daily).toBe(300_000);
    expect(organic.revenue.daily.find((p) => p.date === "2026-10-03")?.daily).toBeCloseTo(2000, 6);
    // Cumulative series unchanged.
    expect(organic.streams.cumulative).toEqual(net.streams.cumulative);
    expect(organic.tracks).toEqual(net.tracks);
  });
});
