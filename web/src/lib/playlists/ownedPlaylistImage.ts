/** Project-owned playlist thumbnails that must not be replaced by Spotify refresh. */
export function isOwnedPlaylistImageUrl(url: string | null | undefined): boolean {
  const value = (url ?? "").trim();
  if (!value) return false;
  if (value.startsWith("/playlist-logos/")) return true;
  return value.includes("/storage/v1/object/public/playlist-logos/");
}
