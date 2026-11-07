import { describe, expect, it } from "vitest";
import worldData from "world-atlas/countries-110m.json";
import {
  MAJOR_TERRITORIES,
  TERRITORY_CSV_HEADERS,
  buildTerritoryCsvRows,
  csvReasons,
  filterRestrictedTracks,
  groupByDistributor,
  groupMarketEvents,
  isMajorTerritory,
  sortByDailyStreams,
  sortTerritories,
} from "./spotifyMarketFormat";
import { ISO2_TO_NUMERIC, iso2FromNumeric } from "./isoNumeric";
import type { SpotifyMarketEvent, SpotifyMarketRestrictedTrack } from "./spotifyMarketTypes";

function track(over: Partial<SpotifyMarketRestrictedTrack> & { isrc: string }): SpotifyMarketRestrictedTrack {
  return {
    spotify_track_id: "t",
    markets_checked: 183,
    available_count: 180,
    unavailable_markets: ["BR"],
    unavailable_reasons: { BR: "market" },
    last_checked_at: "2026-11-07T21:00:00Z",
    name: "Song",
    artist_names: ["Saxena"],
    artist_ids: null,
    album_image_url: null,
    distributor: null,
    daily_streams: null,
    ...over,
  };
}

describe("major territories", () => {
  it("lists the 18 major markets and sorts them first", () => {
    expect(MAJOR_TERRITORIES).toHaveLength(18);
    expect(isMajorTerritory("US")).toBe(true);
    expect(isMajorTerritory("PK")).toBe(false);
    expect(sortTerritories(["PK", "MX", "BR", "AE", "IN", "US"])).toEqual(["US", "BR", "MX", "IN", "PK", "AE"]);
  });
});

describe("territory ordering and grouping", () => {
  it("sorts by daily streams desc, unknown last, ties by more territories missing", () => {
    const a = track({ isrc: "A", daily_streams: 100, unavailable_markets: ["BR"] });
    const b = track({ isrc: "B", daily_streams: 100, unavailable_markets: ["BR", "IN"] });
    const c = track({ isrc: "C", daily_streams: 5000 });
    const d = track({ isrc: "D", daily_streams: null, unavailable_markets: ["BR", "IN", "MX"] });
    expect(sortByDailyStreams([a, b, d, c]).map((t) => t.isrc)).toEqual(["C", "B", "A", "D"]);
  });

  it("groups by distributor with a per-territory track count, major territories first", () => {
    const masafy = { key: "masafy", name: "Masafy LANDR", imageUrl: null };
    const other = { key: "tunecore", name: "TuneCore", imageUrl: null };
    const tracks = [
      track({ isrc: "A", distributor: masafy, unavailable_markets: ["PK", "BR", "IN"], daily_streams: 10 }),
      track({ isrc: "B", distributor: masafy, unavailable_markets: ["BR", "MX"], daily_streams: 20 }),
      track({ isrc: "C", distributor: other, unavailable_markets: ["CA"], daily_streams: 500 }),
      track({ isrc: "D", distributor: null, unavailable_markets: ["BR"], daily_streams: 9999 }),
    ];
    const groups = groupByDistributor(tracks);
    // Unknown distributor always last, even with the most streams.
    expect(groups.map((g) => g.name)).toEqual(["TuneCore", "Masafy LANDR", "No distributor found"]);
    const group = groups[1];
    expect(group.tracks).toHaveLength(2);
    expect(group.dailyStreams).toBe(30);
    expect(group.territories).toEqual([
      { code: "BR", count: 2 },
      { code: "MX", count: 1 },
      { code: "IN", count: 1 },
      { code: "PK", count: 1 },
    ]);
  });
});

describe("territory filters and CSV", () => {
  const masafy = { key: "masafy", name: "Masafy LANDR", imageUrl: null };
  const tracks = [
    track({ isrc: "QZ1", name: "Dance Monkey", artist_names: ["Saxena"], distributor: masafy, unavailable_markets: ["BR", "CA"], unavailable_reasons: { BR: "market", CA: "market" }, daily_streams: 120 }),
    track({ isrc: "QZ2", name: "Get You The Moon", artist_names: ["Other"], distributor: null, unavailable_markets: ["IN"] }),
  ];
  const none = { territories: new Set<string>(), distributorKey: null, query: "" };

  it("filters by territory (any), distributor and text", () => {
    expect(filterRestrictedTracks(tracks, none)).toHaveLength(2);
    expect(filterRestrictedTracks(tracks, { ...none, territories: new Set(["CA", "IN"]) })).toHaveLength(2);
    expect(filterRestrictedTracks(tracks, { ...none, territories: new Set(["CA"]) }).map((t) => t.isrc)).toEqual(["QZ1"]);
    expect(filterRestrictedTracks(tracks, { ...none, distributorKey: "masafy" }).map((t) => t.isrc)).toEqual(["QZ1"]);
    expect(filterRestrictedTracks(tracks, { ...none, distributorKey: "__none" }).map((t) => t.isrc)).toEqual(["QZ2"]);
    expect(filterRestrictedTracks(tracks, { ...none, query: "moon" }).map((t) => t.isrc)).toEqual(["QZ2"]);
    expect(filterRestrictedTracks(tracks, { ...none, query: "saxena" }).map((t) => t.isrc)).toEqual(["QZ1"]);
    expect(filterRestrictedTracks(tracks, { ...none, query: "qz2" }).map((t) => t.isrc)).toEqual(["QZ2"]);
  });

  it("builds CSV rows with the agreed columns", () => {
    expect(TERRITORY_CSV_HEADERS).toEqual([
      "Artist",
      "Title",
      "ISRC",
      "Distributor",
      "Daily streams",
      "Live in",
      "Checked",
      "Missing territories",
      "Reasons",
      "Last checked",
    ]);
    const [row] = buildTerritoryCsvRows([tracks[0]]);
    expect(row).toEqual({
      Artist: "Saxena",
      Title: "Dance Monkey",
      ISRC: "QZ1",
      Distributor: "Masafy LANDR",
      "Daily streams": 120,
      "Live in": 180,
      Checked: 183,
      "Missing territories": "BR CA",
      Reasons: "market",
      "Last checked": "2026-11-07T21:00:00Z",
    });
    expect(csvReasons({ BR: "market", IN: "none" }, ["BR", "IN"])).toBe("BR=market; IN=none");
  });
});

describe("recent changes", () => {
  it("merges same-day same-direction events into one line, newest first", () => {
    const ev = (market: string, event: "lost" | "gained", detected_at: string): SpotifyMarketEvent => ({
      isrc: "QZ1",
      market,
      event,
      reason: null,
      detected_at,
      name: "Dance Monkey",
      artist_names: ["Saxena"],
    });
    const out = groupMarketEvents([
      ev("IN", "lost", "2026-11-07T21:05:00Z"),
      ev("BR", "lost", "2026-11-07T21:05:00Z"),
      ev("CA", "gained", "2026-11-05T21:05:00Z"),
    ]);
    expect(out.map((g) => [g.day, g.event, g.markets])).toEqual([
      ["2026-11-07", "lost", ["BR", "IN"]],
      ["2026-11-05", "gained", ["CA"]],
    ]);
  });
});

describe("ISO numeric table for the map", () => {
  it("maps both directions (zero-padded or numeric ids)", () => {
    expect(ISO2_TO_NUMERIC.BR).toBe("076");
    expect(iso2FromNumeric("076")).toBe("BR");
    expect(iso2FromNumeric(76)).toBe("BR");
    expect(iso2FromNumeric("999")).toBeNull();
    expect(iso2FromNumeric(undefined)).toBeNull();
  });

  it("has unique numeric codes and covers every country in the bundled atlas", () => {
    const codes = Object.values(ISO2_TO_NUMERIC);
    expect(new Set(codes).size).toBe(codes.length);
    const geoms = (worldData as unknown as { objects: { countries: { geometries: { id?: string }[] } } }).objects.countries
      .geometries;
    const unmapped = geoms.filter((g) => g.id != null && iso2FromNumeric(g.id) == null).map((g) => g.id);
    expect(unmapped).toEqual([]);
  });
});
