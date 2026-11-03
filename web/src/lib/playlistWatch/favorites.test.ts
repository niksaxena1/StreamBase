import { describe, expect, it } from "vitest";

import { favoriteIdsFromMarks, withFavorites } from "./favorites";

type Row = { spotifyPlaylistId: string; isFavorite: boolean; followers: number };

function sharedRows(): Row[] {
  return [
    { spotifyPlaylistId: "p1", isFavorite: false, followers: 10 },
    { spotifyPlaylistId: "p2", isFavorite: false, followers: 20 },
  ];
}

describe("favoriteIdsFromMarks", () => {
  it("keeps only marks that are favorites", () => {
    const ids = favoriteIdsFromMarks([
      { spotify_playlist_id: "p1", is_favorite: true },
      { spotify_playlist_id: "p2", is_favorite: false },
    ]);
    expect([...ids]).toEqual(["p1"]);
  });
});

describe("withFavorites", () => {
  it("gives each user only their own marks from the same shared rows, in either order", () => {
    const cached = sharedRows();
    const userA = favoriteIdsFromMarks([{ spotify_playlist_id: "p1", is_favorite: true }]);
    const userB = favoriteIdsFromMarks([]);

    const a1 = withFavorites(cached, userA);
    const b1 = withFavorites(cached, userB);
    const b2 = withFavorites(cached, userB);
    const a2 = withFavorites(cached, userA);

    for (const a of [a1, a2]) expect(a.map((r) => r.isFavorite)).toEqual([true, false]);
    for (const b of [b1, b2]) expect(b.map((r) => r.isFavorite)).toEqual([false, false]);
  });

  it("never mutates the shared cached rows", () => {
    const cached = sharedRows();
    const snapshot = structuredClone(cached);
    const merged = withFavorites(cached, new Set(["p1", "p2"]));
    merged[0].followers = 999;
    expect(cached).toEqual(snapshot);
    expect(merged[0]).not.toBe(cached[0]);
  });

  it("reflects a favorite change immediately, without the cache changing", () => {
    const cached = sharedRows();
    expect(withFavorites(cached, new Set(["p2"]))[1].isFavorite).toBe(true);
    expect(withFavorites(cached, new Set())[1].isFavorite).toBe(false);
  });
});
