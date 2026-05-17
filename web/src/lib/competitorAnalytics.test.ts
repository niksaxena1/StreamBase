import { describe, expect, it } from "vitest";

import { aggregateCompetitorPlaylistHistory } from "@/lib/competitorAnalytics";

describe("aggregateCompetitorPlaylistHistory", () => {
  it("aggregates playlist history rows by date", () => {
    expect(
      aggregateCompetitorPlaylistHistory([
        {
          date: "2026-05-17",
          playlist_key: "a",
          track_count: 10,
          total_streams_cumulative: 100,
          daily_streams_net: 5,
        },
        {
          date: "2026-05-17",
          playlist_key: "b",
          track_count: 20,
          total_streams_cumulative: 300,
          daily_streams_net: 7,
        },
        {
          date: "2026-05-16",
          playlist_key: "a",
          track_count: 9,
          total_streams_cumulative: 95,
          daily_streams_net: 4,
        },
      ]),
    ).toEqual([
      {
        date: "2026-05-17",
        track_count: 30,
        total_streams_cumulative: 400,
        daily_streams_net: 12,
      },
      {
        date: "2026-05-16",
        track_count: 9,
        total_streams_cumulative: 95,
        daily_streams_net: 4,
      },
    ]);
  });
});
