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

/** Accepts a playlist URL, a spotify:playlist: URI, or a bare 22-char id. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (SPOTIFY_ID_RE.test(raw)) return raw;
  const uri = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  const url = raw.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/);
  return url ? url[1] : null;
}

/** Accepts https://www.spotontrack.com/playlists/spotify/<id> or the bare numeric id. */
export function parseSotPlaylistId(input: string): number | null {
  const raw = input.trim();
  const m = raw.match(/^\d+$/) ? [raw, raw] : raw.match(/spotontrack\.com\/playlists\/spotify\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Normalizes to https://www.spotontrack.com/dashboard/<n>. */
export function parseSotDashboardUrl(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?spotontrack\.com\/dashboard\/(\d+)\/?(?:[?#].*)?$/);
  return m ? `https://www.spotontrack.com/dashboard/${m[1]}` : null;
}

/** "#FF6B35" / "ff6b35" -> "FF6B35" (competitor.labels.accent_hex stores 6 hex chars, no #). */
export function normalizeAccentHex(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim().replace(/^#/, "");
  if (!raw) return null;
  return /^[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : null;
}
