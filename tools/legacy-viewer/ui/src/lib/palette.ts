import { fold } from "./pickers";

/** Quick-jump (Ctrl+K) matching and ranking; pure and unit-tested. */
export type PaletteTrack = {
  isrc: string;
  song_name: string;
  artist: string;
  art?: string | null;
  latest_streams?: number;
};
export type PaletteArtist = {
  name: string;
  track_count: number;
  art?: string | null;
};
export type PaletteItem =
  | { kind: "track"; key: string; track: PaletteTrack; tier: number }
  | { kind: "artist"; key: string; artist: PaletteArtist; tier: number };
/** 22-character Spotify ID from a bare ID, spotify:track: URI or open.spotify.com link. */
export function extractSpotifyId(text: string): string | null {
  const match = text
    .trim()
    .match(
      /^(?:.*(?:spotify:track:|\/track\/))?([A-Za-z0-9]{22})(?:[?/#].*)?$/,
    );
  return match ? match[1] : null;
}
const wordStarts = (text: string, q: string) =>
  text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q));
/** Lower tier = better. 99 = no match. */
export function trackTier(track: PaletteTrack, rawQuery: string): number {
  const q = fold(rawQuery.trim());
  if (!q) return 99;
  const title = fold(track.song_name);
  const credits = track.artist.split(",").map((name) => fold(name.trim()));
  const isrc = track.isrc.toLowerCase();
  if (isrc === q) return 0;
  if (title === q) return 1;
  if (title.startsWith(q)) return 2;
  if (credits.some((name) => name.startsWith(q))) return 3;
  if (wordStarts(title, q)) return 4;
  if (title.includes(q)) return 5;
  if (credits.some((name) => name.includes(q))) return 6;
  if (isrc.includes(q)) return 7;
  return 8; // matched by Spotify ID or the combined text on the server
}
export function artistTier(artist: PaletteArtist, rawQuery: string): number {
  const q = fold(rawQuery.trim());
  if (!q) return 99;
  const name = fold(artist.name);
  if (name === q) return 1;
  if (name.startsWith(q)) return 2;
  if (wordStarts(name, q)) return 4;
  return name.includes(q) ? 5 : 99;
}
/**
 * Prefix-first ranking over server candidates: ISRC/exact title, title prefix, artist prefix, word
 * prefix, contains. Ties: more streams first, then title. Tracks and artists share one ordered list
 * (best tier first, tracks before artists on equal tiers) so one arrow-key walk covers both.
 */
export function rankPalette(
  query: string,
  tracks: readonly PaletteTrack[],
  artists: readonly PaletteArtist[],
  limit = { tracks: 8, artists: 4 },
): PaletteItem[] {
  if (!query.trim()) return [];
  const rankedTracks = tracks
    .map((track) => ({ track, tier: trackTier(track, query) }))
    .filter((r) => r.tier < 99)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (b.track.latest_streams ?? 0) - (a.track.latest_streams ?? 0) ||
        fold(a.track.song_name).localeCompare(fold(b.track.song_name)) ||
        a.track.isrc.localeCompare(b.track.isrc),
    )
    .slice(0, limit.tracks)
    .map(
      (r): PaletteItem => ({
        kind: "track",
        key: `t:${r.track.isrc}`,
        ...r,
      }),
    );
  const rankedArtists = artists
    .map((artist) => ({ artist, tier: artistTier(artist, query) }))
    .filter((r) => r.tier < 99)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.artist.track_count - a.artist.track_count ||
        fold(a.artist.name).localeCompare(fold(b.artist.name)),
    )
    .slice(0, limit.artists)
    .map(
      (r): PaletteItem => ({
        kind: "artist",
        key: `a:${r.artist.name}`,
        ...r,
      }),
    );
  return [...rankedTracks, ...rankedArtists].sort((a, b) => a.tier - b.tier);
}
