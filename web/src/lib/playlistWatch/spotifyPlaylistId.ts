const SPOTIFY_PLAYLIST_ID_RE = /^[A-Za-z0-9]{16,32}$/;

export function parseSpotifyPlaylistId(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const uriMatch = raw.match(/^spotify:playlist:([A-Za-z0-9]{16,32})$/);
  if (uriMatch?.[1]) return uriMatch[1];

  const urlMatch = raw.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{16,32})/);
  if (urlMatch?.[1]) return urlMatch[1];

  return SPOTIFY_PLAYLIST_ID_RE.test(raw) ? raw : null;
}
