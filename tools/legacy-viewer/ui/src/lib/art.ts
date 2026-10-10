/** Artwork helpers: initials tiles for tracks/artists without a cached thumbnail. */
export const TILE_TONES = ["tracks", "revenue", "info", "warning", "accent"] as const;
export type TileTone = (typeof TILE_TONES)[number];

/** Up to two letters/digits: initials of the first two words, or the first two characters of one word. */
export function initials(name: string | null | undefined): string {
  const words = Array.from((name ?? "").normalize("NFKC").trim().split(/\s+/)).filter(Boolean);
  const alnum = (word: string) => Array.from(word).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const parts = words.map((word) => alnum(word)).filter((letters) => letters.length);
  if (!parts.length) return "♪";
  const letters =
    parts.length > 1 ? [parts[0][0], parts[1][0]] : parts[0].slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}

/** Stable colour per name, so the same artist/track always gets the same tile. */
export function tileTone(name: string | null | undefined): TileTone {
  let hash = 5381;
  for (const char of name ?? "") hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return TILE_TONES[hash % TILE_TONES.length];
}

/** Largest CSS size of the enlarged preview: sources are 64px covers / 160px artist photos, so no blurry upscaling. */
export const PREVIEW_MAX = 160;
