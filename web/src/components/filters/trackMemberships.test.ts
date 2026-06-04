import { describe, expect, it } from "vitest";

import { buildCurrentTrackMemberships } from "./trackMemberships";

describe("buildCurrentTrackMemberships", () => {
  it("separates own-catalog distro and entity playlists", () => {
    const memberships = new Map([
      ["distro-a", new Set(["ISRC1"])],
      ["entity-a", new Set(["ISRC1"])],
      ["label-a", new Set(["ISRC1"])],
    ]);

    expect(
      buildCurrentTrackMemberships({
        isrc: "ISRC1",
        datasetMode: "own",
        playlists: [
          { playlist_key: "distro-a", display_name: "Distro A", playlist_type: "Distro" },
          { playlist_key: "entity-a", display_name: "Entity A", playlist_type: "Entity" },
          { playlist_key: "label-a", display_name: "Label A", playlist_type: "Label" },
        ],
        memberships,
      }),
    ).toEqual({
      distro: [{ key: "distro-a", name: "Distro A", imageUrl: null }],
      entity: [{ key: "entity-a", name: "Entity A", imageUrl: null }],
      current: [],
    });
  });

  it("uses the track's scoped competitor playlist list", () => {
    expect(
      buildCurrentTrackMemberships({
        isrc: "ISRC1",
        datasetMode: "competitor",
        playlists: [],
        memberships: new Map(),
        competitorPlaylists: [{ key: "comp-a", name: "Competitor A", imageUrl: null }],
      }),
    ).toEqual({
      distro: [],
      entity: [],
      current: [{ key: "comp-a", name: "Competitor A", imageUrl: null }],
    });
  });
});
