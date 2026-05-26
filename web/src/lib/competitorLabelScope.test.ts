import { describe, expect, it } from "vitest";

import { filterIsrcsForArtist, isInCompetitorScope } from "@/lib/competitorLabelScope";

describe("isInCompetitorScope", () => {
  it("allows all when scope is null", () => {
    expect(isInCompetitorScope("any", null)).toBe(true);
  });

  it("checks membership when scope is set", () => {
    const scope = new Set(["a", "b"]);
    expect(isInCompetitorScope("a", scope)).toBe(true);
    expect(isInCompetitorScope("c", scope)).toBe(false);
  });
});

describe("filterIsrcsForArtist", () => {
  const tracks = [
    { isrc: "X1", spotify_artist_ids: ["artist-a", "artist-b"] },
    { isrc: "X2", spotify_artist_ids: ["artist-b"] },
    { isrc: "X3", spotify_artist_ids: ["artist-c"] },
  ];

  it("keeps isrcs credited to the artist", () => {
    expect(filterIsrcsForArtist(["X1", "X2", "X3"], tracks, "artist-b").sort()).toEqual([
      "X1",
      "X2",
    ]);
  });

  it("returns empty for unknown artist", () => {
    expect(filterIsrcsForArtist(["X1"], tracks, "missing")).toEqual([]);
  });
});
