import { describe, expect, it } from "vitest";

import { resolveCatalogTrackSelection } from "./catalogSelection";

type Track = {
  isrc: string;
  spotify_artist_ids: string[] | null;
  name: string;
};

const track = (isrc: string, artistIds: string[] | null, name = isrc): Track => ({
  isrc,
  spotify_artist_ids: artistIds,
  name,
});

describe("resolveCatalogTrackSelection", () => {
  it("keeps a track already present in the selected artist list", () => {
    const selected = track("ISRC-1", ["artist-1"]);

    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "artist-1",
        requestedIsrc: "ISRC-1",
        artistTracks: [selected],
        resolvedTrack: null,
        resolvedTrackIsActiveInScope: true,
      }),
    ).toEqual({ kind: "valid", track: selected, shouldInject: false });
  });

  it("injects a valid directly resolved track omitted by a bounded artist list", () => {
    const selected = track("ISRC-LONG-TAIL", ["artist-1"]);

    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "artist-1",
        requestedIsrc: selected.isrc,
        artistTracks: [],
        resolvedTrack: selected,
        resolvedTrackIsActiveInScope: true,
      }),
    ).toEqual({ kind: "valid", track: selected, shouldInject: true });
  });

  it("redirects a mismatched artist to the track's primary artist", () => {
    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "wrong-artist",
        requestedIsrc: "ISRC-2",
        artistTracks: [],
        resolvedTrack: track("ISRC-2", ["primary-artist", "featured-artist"]),
        resolvedTrackIsActiveInScope: true,
      }),
    ).toEqual({ kind: "redirect", artistId: "primary-artist", isrc: "ISRC-2" });
  });

  it("marks a historical competitor track as inactive instead of selecting another track", () => {
    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "artist-1",
        requestedIsrc: "ISRC-OLD",
        artistTracks: [],
        resolvedTrack: track("ISRC-OLD", ["artist-1"]),
        resolvedTrackIsActiveInScope: false,
      }),
    ).toEqual({ kind: "unavailable", reason: "not_active" });
  });

  it("distinguishes missing tracks from tracks without artist metadata", () => {
    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "artist-1",
        requestedIsrc: "ISRC-MISSING",
        artistTracks: [],
        resolvedTrack: null,
        resolvedTrackIsActiveInScope: true,
      }),
    ).toEqual({ kind: "unavailable", reason: "not_found" });

    expect(
      resolveCatalogTrackSelection({
        requestedArtistId: "artist-1",
        requestedIsrc: "ISRC-NO-ARTIST",
        artistTracks: [],
        resolvedTrack: track("ISRC-NO-ARTIST", null),
        resolvedTrackIsActiveInScope: true,
      }),
    ).toEqual({ kind: "unavailable", reason: "missing_artist_metadata" });
  });
});
