import { describe, it, expect } from "vitest";
import {
  filterTracksClientSide,
  filterArtistsClientSide,
  filterPlaylistsClientSide,
  aggregateTracksToArtistData,
  hasActiveConditions,
  countActiveConditions,
} from "./filterQuery";
import type { TrackDataPoint, ArtistDataPoint, PlaylistDataPoint } from "./filterQuery";
import type { FilterConfig, FilterGroup, FilterCondition } from "./filterTypes";

// ============================================================================
// Test data factories
// ============================================================================

function makeFilter(overrides: Partial<FilterConfig> = {}): FilterConfig {
  return {
    id: "test-filter",
    name: "Test",
    entityType: "tracks",
    groups: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

function makeGroup(conditions: FilterCondition[], logic: "AND" | "OR" = "AND"): FilterGroup {
  return { id: "g1", logic, conditions };
}

function makeCond(overrides: Partial<FilterCondition> = {}): FilterCondition {
  return {
    id: "c1",
    field: "",
    operator: "eq",
    value: null,
    enabled: true,
    ...overrides,
  };
}

const sampleTracks: TrackDataPoint[] = [
  {
    isrc: "US1234567890",
    name: "Big Hit",
    release_date: "2025-06-15",
    spotify_artist_names: ["Artist A"],
    spotify_artist_ids: ["a1"],
    total_streams_cumulative: 5_000_000,
    daily_streams: 10_000,
    spotify_track_id: "t1",
    spotify_album_image_url: null,
    playlist_keys: ["releases", "label_x"],
  },
  {
    isrc: "US0987654321",
    name: "Small Song",
    release_date: "2026-01-01",
    spotify_artist_names: ["Artist B"],
    spotify_artist_ids: ["b1"],
    total_streams_cumulative: 100_000,
    daily_streams: 500,
    spotify_track_id: "t2",
    spotify_album_image_url: null,
    playlist_keys: ["releases"],
  },
  {
    isrc: "GB1111111111",
    name: "Collab Track",
    release_date: "2025-03-10",
    spotify_artist_names: ["Artist A", "Artist C"],
    spotify_artist_ids: ["a1", "c1"],
    total_streams_cumulative: 2_000_000,
    daily_streams: 3000,
    spotify_track_id: "t3",
    spotify_album_image_url: null,
    playlist_keys: ["label_x"],
  },
];

const sampleArtists: ArtistDataPoint[] = [
  { artist_id: "a1", artist_name: "Artist A", total_streams: 7_000_000, track_count: 2, daily_streams: 13000, image_url: null, in_house_status: "in_house" },
  { artist_id: "b1", artist_name: "Artist B", total_streams: 100_000, track_count: 1, daily_streams: 500, image_url: null },
];

const samplePlaylists: PlaylistDataPoint[] = [
  { playlist_key: "releases", display_name: "Releases", track_count: 50, total_streams: 10_000_000, daily_streams: 20_000, is_catalog: true, playlist_type: "Catalog", collector: "MAIN", spotify_playlist_image_url: null },
  { playlist_key: "label_x", display_name: "Label X", track_count: 10, total_streams: 500_000, daily_streams: 1000, is_catalog: false, playlist_type: "Label", collector: "OTHER", spotify_playlist_image_url: null },
];

// ============================================================================
// filterTracksClientSide
// ============================================================================

describe("filterTracksClientSide", () => {
  it("returns all tracks when filter has no groups", () => {
    const filter = makeFilter({ groups: [] });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(3);
  });

  it("filters by total_streams greater than", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "gt", value: 1_000_000 })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.total_streams > 1_000_000)).toBe(true);
  });

  it("filters by total_streams less than", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "lt", value: 200_000 })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].isrc).toBe("US0987654321");
  });

  it("filters by total_streams between", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "between", value: { min: 100_000, max: 3_000_000 } })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2); // 100k and 2M
  });

  it("filters by track_name contains", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "track_name", operator: "contains", value: "song" })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Small Song");
  });

  it("filters by release_date before", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "release_date", operator: "before", value: "2025-12-31" })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2); // Jun 2025 and Mar 2025
  });

  it("filters by release_date month_is", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "release_date", operator: "month_is", value: "6" })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Big Hit");
  });

  it("filters by release_date year_is", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "release_date", operator: "year_is", value: "2026" })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Small Song");
  });

  it("filters by artist 'in' (multi-select)", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "artist", operator: "in", value: ["c1"] })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Collab Track");
  });

  it("filters by playlist 'in' (multi-select)", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "playlist", operator: "in", value: ["label_x"] })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2); // Big Hit and Collab Track
  });

  it("supports OR logic within a group", () => {
    const filter = makeFilter({
      groups: [
        makeGroup(
          [
            makeCond({ id: "c1", field: "total_streams", operator: "gt", value: 4_000_000 }),
            makeCond({ id: "c2", field: "total_streams", operator: "lt", value: 200_000 }),
          ],
          "OR",
        ),
      ],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2); // Big Hit (5M) and Small Song (100K)
  });

  it("supports AND logic across groups", () => {
    const filter = makeFilter({
      groups: [
        makeGroup([makeCond({ field: "total_streams", operator: "gt", value: 100_000 })]),
        makeGroup([makeCond({ field: "track_name", operator: "contains", value: "collab" })]),
      ],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Collab Track");
  });

  it("supports OR logic across groups", () => {
    const filter = makeFilter({
      groupJoinLogic: "OR",
      groups: [
        makeGroup([makeCond({ field: "total_streams", operator: "gt", value: 4_000_000 })]),
        makeGroup([makeCond({ field: "track_name", operator: "contains", value: "collab" })]),
      ],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(2);
    const names = [...results.map((r) => r.name)].sort();
    expect(names).toEqual(["Big Hit", "Collab Track"]);
  });

  it("ignores disabled conditions", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "gt", value: 999_999_999, enabled: false })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(3); // disabled condition matches all
  });

  it("ignores conditions with empty value", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "gt", value: null })])],
    });
    const results = filterTracksClientSide(sampleTracks, filter);
    expect(results).toHaveLength(3);
  });
});

// ============================================================================
// filterArtistsClientSide
// ============================================================================

describe("filterArtistsClientSide", () => {
  it("filters artists by track_count", () => {
    const filter = makeFilter({
      entityType: "artists",
      groups: [makeGroup([makeCond({ field: "track_count", operator: "gt", value: 1 })])],
    });
    const results = filterArtistsClientSide(sampleArtists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].artist_name).toBe("Artist A");
  });

  it("filters artists by name contains", () => {
    const filter = makeFilter({
      entityType: "artists",
      groups: [makeGroup([makeCond({ field: "artist_name", operator: "contains", value: "artist b" })])],
    });
    const results = filterArtistsClientSide(sampleArtists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].artist_name).toBe("Artist B");
  });

  it("filters artists by in-house status", () => {
    const filter = makeFilter({
      entityType: "artists",
      groups: [makeGroup([makeCond({ field: "in_house_status", operator: "eq", value: "in_house" })])],
    });
    const results = filterArtistsClientSide(sampleArtists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].artist_id).toBe("a1");
  });
});

// ============================================================================
// filterPlaylistsClientSide
// ============================================================================

describe("filterPlaylistsClientSide", () => {
  it("filters playlists by track_count", () => {
    const filter = makeFilter({
      entityType: "playlists",
      groups: [makeGroup([makeCond({ field: "track_count", operator: "gte", value: 50 })])],
    });
    const results = filterPlaylistsClientSide(samplePlaylists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].display_name).toBe("Releases");
  });

  it("filters playlists by is_catalog boolean", () => {
    const filter = makeFilter({
      entityType: "playlists",
      groups: [makeGroup([makeCond({ field: "is_catalog", operator: "eq", value: "true" })])],
    });
    const results = filterPlaylistsClientSide(samplePlaylists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].is_catalog).toBe(true);
  });

  it("filters playlists by name starts_with", () => {
    const filter = makeFilter({
      entityType: "playlists",
      groups: [makeGroup([makeCond({ field: "display_name", operator: "starts_with", value: "Label" })])],
    });
    const results = filterPlaylistsClientSide(samplePlaylists, filter);
    expect(results).toHaveLength(1);
    expect(results[0].display_name).toBe("Label X");
  });
});

// ============================================================================
// aggregateTracksToArtistData
// ============================================================================

describe("aggregateTracksToArtistData", () => {
  it("aggregates tracks by artist", () => {
    const artistImages = new Map<string, { name: string; image_url: string | null }>();
    artistImages.set("a1", { name: "Artist A", image_url: "http://img-a.jpg" });

    const result = aggregateTracksToArtistData(sampleTracks, artistImages);

    // Artist A appears on Big Hit (5M) and Collab Track (2M)
    const artistA = result.find((a) => a.artist_id === "a1");
    expect(artistA).toBeDefined();
    expect(artistA!.total_streams).toBe(7_000_000);
    expect(artistA!.track_count).toBe(2);
    expect(artistA!.image_url).toBe("http://img-a.jpg");

    // Artist B appears on Small Song (100K)
    const artistB = result.find((a) => a.artist_id === "b1");
    expect(artistB).toBeDefined();
    expect(artistB!.total_streams).toBe(100_000);
    expect(artistB!.track_count).toBe(1);

    // Artist C appears on Collab Track (2M)
    const artistC = result.find((a) => a.artist_id === "c1");
    expect(artistC).toBeDefined();
    expect(artistC!.total_streams).toBe(2_000_000);
    expect(artistC!.track_count).toBe(1);
  });

  it("aggregates playlist_keys from tracks", () => {
    const result = aggregateTracksToArtistData(sampleTracks, new Map());
    const artistA = result.find((a) => a.artist_id === "a1");
    expect(artistA!.playlist_keys).toContain("releases");
    expect(artistA!.playlist_keys).toContain("label_x");
  });

  it("marks artists as in-house from artist metadata", () => {
    const artistImages = new Map<string, { name: string; image_url: string | null; in_house?: boolean }>();
    artistImages.set("a1", { name: "Artist A", image_url: null, in_house: true });

    const result = aggregateTracksToArtistData(sampleTracks, artistImages);
    expect(result.find((a) => a.artist_id === "a1")?.in_house_status).toBe("in_house");
    expect(result.find((a) => a.artist_id === "b1")?.in_house_status).toBe("nih");
  });

  it("handles empty tracks", () => {
    expect(aggregateTracksToArtistData([], new Map())).toEqual([]);
  });
});

// ============================================================================
// hasActiveConditions / countActiveConditions
// ============================================================================

describe("hasActiveConditions", () => {
  it("returns false for empty filter", () => {
    expect(hasActiveConditions(makeFilter({ groups: [] }))).toBe(false);
  });

  it("returns false for filter with only disabled/empty conditions", () => {
    const filter = makeFilter({
      groups: [makeGroup([
        makeCond({ field: "total_streams", operator: "gt", value: 1000, enabled: false }),
        makeCond({ field: "", operator: "eq", value: null }),
      ])],
    });
    expect(hasActiveConditions(filter)).toBe(false);
  });

  it("returns true when there is an active condition with value", () => {
    const filter = makeFilter({
      groups: [makeGroup([makeCond({ field: "total_streams", operator: "gt", value: 1000 })])],
    });
    expect(hasActiveConditions(filter)).toBe(true);
  });
});

describe("countActiveConditions", () => {
  it("returns 0 for empty filter", () => {
    expect(countActiveConditions(makeFilter({ groups: [] }))).toBe(0);
  });

  it("counts only active conditions with values", () => {
    const filter = makeFilter({
      groups: [
        makeGroup([
          makeCond({ id: "c1", field: "total_streams", operator: "gt", value: 1000 }),
          makeCond({ id: "c2", field: "daily_streams", operator: "lt", value: 500 }),
          makeCond({ id: "c3", field: "track_name", operator: "contains", value: null }),
          makeCond({ id: "c4", field: "total_streams", operator: "gt", value: 100, enabled: false }),
        ]),
      ],
    });
    expect(countActiveConditions(filter)).toBe(2);
  });
});
