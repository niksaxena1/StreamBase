import type { DatasetMode } from "@/lib/datasetMode";

/** localStorage keys scoped per analytics universe (own catalog vs competitor). */
export function lastPlaylistKeyStorageKey(mode: DatasetMode): string {
  return `sb:last_playlist_key:${mode}`;
}

export function lastArtistIdStorageKey(mode: DatasetMode): string {
  return `sb:last_artist_id:${mode}`;
}

export function lastIsrcByArtistStorageKey(mode: DatasetMode, artistId: string): string {
  return `sb:last_isrc_by_artist:${mode}:${artistId}`;
}

export function lastCatalogTrackIsrcStorageKey(mode: DatasetMode): string {
  return `sb:last_catalog_track_isrc:${mode}`;
}

/** Read scoped value, falling back once to legacy unscoped keys from before mode split. */
export function readDatasetSelectionStorage(scopedKey: string, legacyKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped?.trim()) return scoped.trim();
    const legacy = localStorage.getItem(legacyKey);
    if (legacy?.trim()) {
      localStorage.setItem(scopedKey, legacy.trim());
      return legacy.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

export function writeDatasetSelectionStorage(scopedKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedKey, value);
  } catch {
    // ignore
  }
}
