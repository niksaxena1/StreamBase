export function spotifyUserUrl(ownerId: string | null | undefined): string | null {
  const id = String(ownerId ?? "").trim();
  if (!id) return null;
  return `https://open.spotify.com/user/${encodeURIComponent(id)}`;
}
