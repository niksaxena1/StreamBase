/**
 * Favorites are per user, so they must never live inside the shared playlist cache. The loader
 * caches rows without favorites and merges the viewer's marks into fresh copies on every load.
 */
export type FavoriteMarkRow = {
  spotify_playlist_id: string;
  is_favorite: boolean;
};

export function favoriteIdsFromMarks(marks: readonly FavoriteMarkRow[]): Set<string> {
  return new Set(marks.filter((m) => m.is_favorite).map((m) => m.spotify_playlist_id));
}

/** Returns new row objects; the input rows (shared cache entries) are left untouched. */
export function withFavorites<T extends { spotifyPlaylistId: string }>(
  rows: readonly T[],
  favoriteIds: ReadonlySet<string>,
): (T & { isFavorite: boolean })[] {
  return rows.map((row) => ({ ...row, isFavorite: favoriteIds.has(row.spotifyPlaylistId) }));
}
