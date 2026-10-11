import { describe, expect, it } from "vitest";
import { catalogDefaultsHref, defaultCatalogArtistId, defaultCatalogIsrc } from "./catalogDefaults";

describe("catalog defaults", () => {
  it("uses the most recent track's first artist and handles missing metadata", () => {
    expect(defaultCatalogArtistId({ spotify_artist_ids: [" first ", "second"] })).toBe("first");
    expect(defaultCatalogArtistId(null)).toBe("");
    expect(defaultCatalogArtistId({ spotify_artist_ids: [] })).toBe("");
  });
  const tracks = [{ isrc: "B", name: "Zulu" }, { isrc: "A", name: "Alpha" }, { isrc: "C", name: null }];
  it("selects alphabetically in own mode without mutating the source order", () => {
    expect(defaultCatalogIsrc(null, tracks, "own")).toBe("A");
    expect(tracks.map((t) => t.isrc)).toEqual(["B", "A", "C"]);
  });
  it("preserves competitor track order rather than borrowing own-mode ordering", () => {
    expect(defaultCatalogIsrc(null, tracks, "competitor")).toBe("B");
  });
  it("preserves explicit ISRCs and handles empty catalogs in both universes", () => {
    for (const mode of ["own", "competitor"] as const) {
      expect(defaultCatalogIsrc("explicit", tracks, mode)).toBe("explicit");
      expect(defaultCatalogIsrc(null, [], mode)).toBeNull();
    }
  });
  it("fills the rendered selection while preserving range, custom dates, and fragments", () => {
    expect(catalogDefaultsHref("/catalog?range=90&start=2026-10-01&end=2026-10-10#chart", "artist", "track"))
      .toBe("/catalog?range=90&start=2026-10-01&end=2026-10-10&artist_id=artist&isrc=track#chart");
  });
  it("leaves explicit URLs and other routes unchanged", () => {
    expect(catalogDefaultsHref("/catalog?artist_id=explicit&isrc=explicit-track", "default", "default-track")).toBeNull();
    expect(catalogDefaultsHref("/playlists", "artist", "track")).toBeNull();
    expect(catalogDefaultsHref("/catalog?artist_id=explicit", "explicit", "track")).toBe("/catalog?artist_id=explicit&isrc=track");
  });
});
