/** Pure helpers for competitor label scoping (testable without Supabase). */

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function filterIsrcsForArtist(
  isrcs: Iterable<string>,
  tracks: ReadonlyArray<{ isrc: string; spotify_artist_ids?: string[] | null }>,
  artistId: string,
): string[] {
  const id = artistId.trim();
  if (!id) return [];
  const trackByIsrc = new Map(tracks.map((t) => [t.isrc, t]));
  const out: string[] = [];
  for (const isrc of isrcs) {
    const row = trackByIsrc.get(isrc);
    if (row && (row.spotify_artist_ids ?? []).includes(id)) out.push(isrc);
  }
  return out;
}

export function isInCompetitorScope(
  id: string,
  scope: ReadonlySet<string> | null | undefined,
): boolean {
  if (!scope) return true;
  return scope.has(id);
}
