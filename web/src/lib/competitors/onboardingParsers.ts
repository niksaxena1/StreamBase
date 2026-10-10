/**
 * Link/key parsers for the /competitors "Add competitor" form. Kept free of
 * zod so the client form can import them without the validation bundle.
 */

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;
export const KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** "Diepgraven Records 🌴 | All Releases" -> "diepgraven_records_all_releases" */
export function slugifyKey(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");
}

/** Parse complete URLs only: reject lookalike hosts, credentials and path suffixes. */
function linkUrl(input: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** Accepts a playlist URL, a spotify:playlist: URI, or a bare 22-char id. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const raw = input.trim();
  if (SPOTIFY_ID_RE.test(raw)) return raw;
  const uri = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  const url = linkUrl(raw);
  if (url?.hostname !== "open.spotify.com") return null;
  const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/);
  return match?.[1] ?? null;
}

function positiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Accepts https://www.spotontrack.com/playlists/spotify/<id> or the bare numeric id. */
export function parseSotPlaylistId(input: string): number | null {
  const raw = input.trim();
  if (/^\d+$/.test(raw)) return positiveId(raw);
  const url = linkUrl(raw);
  if (!url || !["spotontrack.com", "www.spotontrack.com"].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/playlists\/spotify\/(\d+)\/?$/);
  return match ? positiveId(match[1]) : null;
}

/** Normalize dashboard identity, including leading zeros, to its canonical HTTPS URL. */
export function parseSotDashboardUrl(input: string): string | null {
  const url = linkUrl(input.trim());
  if (!url || !["spotontrack.com", "www.spotontrack.com"].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/dashboard\/(\d+)\/?$/);
  const id = match ? positiveId(match[1]) : null;
  return id ? `https://www.spotontrack.com/dashboard/${id}` : null;
}

/** "#FF6B35" / "ff6b35" -> "FF6B35" (stored as 6 hex chars, no #). */
export function normalizeAccentHex(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim().replace(/^#/, "");
  if (!raw) return null;
  return /^[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : null;
}
