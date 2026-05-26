/**
 * Pure catalog deep-link builder (no Supabase). Server wrapper resolves track → artist.
 */
export function buildCatalogDeepLinkPathFromResolved(args: {
  artistId?: string;
  isrc?: string;
  range?: string;
  /** Primary Spotify artist from tracks lookup in the active universe. */
  primaryArtistIdFromTrack?: string | null;
}): string {
  const artistId = (args.artistId ?? "").trim();
  const isrc = (args.isrc ?? "").trim();
  const range = (args.range ?? "").trim();
  const primaryArtistId = (args.primaryArtistIdFromTrack ?? "").trim();

  const params = new URLSearchParams();
  if (range) params.set("range", range);

  if (artistId) {
    params.set("artist_id", artistId);
    if (isrc) params.set("isrc", isrc);
    return `/catalog?${params.toString()}`;
  }

  if (isrc && primaryArtistId) {
    params.set("artist_id", primaryArtistId);
    params.set("isrc", isrc);
    return `/catalog?${params.toString()}`;
  }

  return "/catalog";
}
