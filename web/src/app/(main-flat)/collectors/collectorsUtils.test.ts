import { describe, expect, test } from "vitest";

import {
  aggregateMonthlyDelta,
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
