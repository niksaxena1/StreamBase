import { describe, expect, it } from "vitest";

import { buildCatalogDeepLinkPathFromResolved } from "@/lib/catalogDeepLink";

describe("buildCatalogDeepLinkPathFromResolved", () => {
  it("builds artist + track URL", () => {
    expect(
      buildCatalogDeepLinkPathFromResolved({
        artistId: "artist-1",
        isrc: "USRC123",
      }),
    ).toBe("/catalog?artist_id=artist-1&isrc=USRC123");
  });

  it("resolves isrc via primary artist from track lookup", () => {
    expect(
      buildCatalogDeepLinkPathFromResolved({
        isrc: "USRC123",
        primaryArtistIdFromTrack: "artist-9",
      }),
    ).toBe("/catalog?artist_id=artist-9&isrc=USRC123");
  });

  it("falls back to plain catalog when isrc is not in the active universe", () => {
    expect(
      buildCatalogDeepLinkPathFromResolved({
        isrc: "USRC123",
        primaryArtistIdFromTrack: null,
      }),
    ).toBe("/catalog");
  });

  it("includes range when provided", () => {
    expect(
      buildCatalogDeepLinkPathFromResolved({
        artistId: "a",
        range: "90",
      }),
    ).toBe("/catalog?range=90&artist_id=a");
  });
});
