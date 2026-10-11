/** Explicit artist/track deep links always win over remembered selection. */
export function rememberedCatalogArtist(href: string, remembered: string | null, serverArtist: string): string | null {
  const url = new URL(href, "https://streambase.invalid");
  if (url.pathname !== "/catalog" || url.searchParams.get("artist_id")?.trim() || url.searchParams.get("isrc")?.trim()) return null;
  const artist = remembered?.trim();
  return artist && artist !== serverArtist ? artist : null;
}

export function rememberedArtistHref(href: string, artist: string): string {
  const url = new URL(href, "https://streambase.invalid");
  url.searchParams.set("artist_id", artist);
  url.searchParams.delete("isrc");
  return url.pathname + url.search + url.hash;
}
