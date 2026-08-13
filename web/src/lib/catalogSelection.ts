export type CatalogSelectionTrack = {
  isrc: string;
  spotify_artist_ids: string[] | null;
};

export type CatalogTrackSelection<T extends CatalogSelectionTrack> =
  | { kind: "valid"; track: T; shouldInject: boolean }
  | { kind: "redirect"; artistId: string; isrc: string }
  | {
      kind: "unavailable";
      reason: "not_found" | "not_active" | "missing_artist_metadata";
    };

/**
 * Resolve a requested catalog track without turning bounded dropdown data into
 * an existence check. The caller supplies a direct ISRC lookup only when the
 * track was absent from the already-loaded artist list.
 */
export function resolveCatalogTrackSelection<T extends CatalogSelectionTrack>(args: {
  requestedArtistId: string;
  requestedIsrc: string;
  artistTracks: T[];
  resolvedTrack: T | null;
  resolvedTrackIsActiveInScope: boolean;
}): CatalogTrackSelection<T> {
  const selectedFromArtist = args.artistTracks.find((track) => track.isrc === args.requestedIsrc);
  if (selectedFromArtist) {
    return { kind: "valid", track: selectedFromArtist, shouldInject: false };
  }

  if (!args.resolvedTrack) {
    return { kind: "unavailable", reason: "not_found" };
  }

  if (!args.resolvedTrackIsActiveInScope) {
    return { kind: "unavailable", reason: "not_active" };
  }

  const artistIds = (args.resolvedTrack.spotify_artist_ids ?? [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  if (args.requestedArtistId && artistIds.includes(args.requestedArtistId)) {
    return { kind: "valid", track: args.resolvedTrack, shouldInject: true };
  }

  const primaryArtistId = artistIds[0] ?? "";
  if (primaryArtistId) {
    return {
      kind: "redirect",
      artistId: primaryArtistId,
      isrc: args.requestedIsrc,
    };
  }

  return { kind: "unavailable", reason: "missing_artist_metadata" };
}
