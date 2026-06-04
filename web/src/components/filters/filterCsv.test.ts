import { describe, expect, it } from "vitest";

import { buildFilterCsvRows } from "./filterCsv";

describe("buildFilterCsvRows", () => {
  it("exports both streams and revenue plus current playlist names", () => {
    const rows = buildFilterCsvRows([
      {
        isrc: "SE5BU2515517",
        total_streams: 1_000,
        daily_streams: 10,
        est_total_revenue: 2,
        est_daily_revenue: 0.02,
        spotify_artist_names: ["Artist A"],
        spotify_artist_ids: ["artist-a"],
        current_distro_playlists: [{ key: "distro-a", name: "Distro A", imageUrl: null }],
        current_entity_playlists: [{ key: "entity-a", name: "Entity A", imageUrl: null }],
        current_playlists: [],
      },
    ]);

    expect(rows[0]).toMatchObject({
      isrc: "SE5BU2515517",
      total_streams: 1_000,
      daily_streams: 10,
      est_total_revenue: 2,
      est_daily_revenue: 0.02,
      artists: "Artist A",
      artist_ids: "artist-a",
      current_distro_playlists: "Distro A",
      current_entity_playlists: "Entity A",
      current_playlists: "",
    });
  });
});
