import type { LibraryRow } from "./types";
import type { LibrarySortKey } from "./filters";

export type LibraryColumnId =
  | "select"
  | "cover"
  | "release"
  | "artist"
  | "title"
  | "originality"
  | "entity"
  | "distributor"
  | "labelGenre"
  | "comment1"
  | "comment2"
  | "isrc"
  | "upc"
  | "streams"
  | "streams7d"
  | "length"
  | "master"
  | "drive"
  | "catalog";

export type LibraryColumn = {
  id: LibraryColumnId;
  /** Header text. Empty for the checkbox and cover columns. */
  label: string;
  /** CSS grid track. The header and every row use the same list, so they line up. */
  track: string;
  /** Smallest width of the track in px. */
  minPx: number;
  align?: "right" | "center";
  sort?: LibrarySortKey;
  pinned?: boolean;
};

/** Every table column, in display order. Header and rows are both drawn from this list. */
export const LIBRARY_TABLE_COLUMNS: readonly LibraryColumn[] = [
  { id: "select", label: "", track: "32px", minPx: 32, pinned: true },
  { id: "cover", label: "", track: "24px", minPx: 24, pinned: true },
  { id: "release", label: "Release date", track: "116px", minPx: 116, sort: "release", pinned: true },
  { id: "artist", label: "Artist", track: "170px", minPx: 170, sort: "artist", pinned: true },
  { id: "title", label: "Title", track: "210px", minPx: 210, sort: "title", pinned: true },
  { id: "originality", label: "Orig.", track: "64px", minPx: 64, align: "center" },
  { id: "entity", label: "Entity", track: "96px", minPx: 96, sort: "entity" },
  { id: "distributor", label: "Distributor", track: "120px", minPx: 120, sort: "distributor" },
  { id: "labelGenre", label: "Label / Genre", track: "136px", minPx: 136, sort: "labelGenre" },
  { id: "comment1", label: "Comment 1", track: "minmax(120px,1fr)", minPx: 120, sort: "comment1" },
  { id: "comment2", label: "Comment 2", track: "minmax(120px,1fr)", minPx: 120, sort: "comment2" },
  { id: "isrc", label: "ISRC", track: "128px", minPx: 128, sort: "isrc" },
  { id: "upc", label: "UPC", track: "116px", minPx: 116, sort: "upc" },
  { id: "streams", label: "Streams", track: "72px", minPx: 72, align: "right", sort: "streams" },
  { id: "streams7d", label: "7 days", track: "64px", minPx: 64, align: "right", sort: "streams7d" },
  { id: "length", label: "Length", track: "88px", minPx: 88, align: "right", sort: "duration" },
  { id: "master", label: "Master", track: "76px", minPx: 76, align: "center" },
  { id: "drive", label: "Drive", track: "68px", minPx: 68, align: "center" },
  { id: "catalog", label: "Catalog ID", track: "92px", minPx: 92, sort: "catalog" },
];

export const DEFAULT_HIDDEN_COLUMNS: LibraryColumnId[] = ["catalog"];
export const LIBRARY_COLUMNS_STORAGE_KEY = "sb:library:columns";

export function visibleLibraryColumns(hidden: readonly string[] = DEFAULT_HIDDEN_COLUMNS): readonly LibraryColumn[] {
  return LIBRARY_TABLE_COLUMNS.filter((c) => c.pinned || !hidden.includes(c.id));
}

export function parseHiddenColumns(raw: string | null): LibraryColumnId[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_COLUMNS];
    return LIBRARY_TABLE_COLUMNS.filter((c) => !c.pinned && parsed.includes(c.id)).map((c) => c.id);
  } catch {
    return [...DEFAULT_HIDDEN_COLUMNS];
  }
}

export function libraryGridTemplate(columns: readonly LibraryColumn[]): string {
  return columns.map((c) => c.track).join(" ");
}

export function libraryMinWidth(columns: readonly LibraryColumn[]): number {
  return columns.reduce((sum, c) => sum + c.minPx, 0);
}

export function libraryPinnedOffsets(columns: readonly LibraryColumn[]): Map<LibraryColumnId, number> {
  let left = 0;
  const offsets = new Map<LibraryColumnId, number>();
  for (const c of columns) {
    if (!c.pinned) continue;
    offsets.set(c.id, left);
    left += c.minPx;
  }
  return offsets;
}

export const LIBRARY_GRID_COLUMNS = libraryGridTemplate(LIBRARY_TABLE_COLUMNS);

/** Cell padding is included in the grid tracks. */
export const LIBRARY_TABLE_MIN_WIDTH = libraryMinWidth(LIBRARY_TABLE_COLUMNS);

export type OriginalityInfo = { kind: "cover" | "original"; text: string };

/** What the Originality icon shows. null when the value is unknown (no icon). */
export function originalityInfo(row: Pick<LibraryRow, "originality" | "cover_original_artist">): OriginalityInfo | null {
  const value = (row.originality ?? "").trim().toLowerCase();
  if (value === "cover") {
    const artist = (row.cover_original_artist ?? "").trim();
    return { kind: "cover", text: artist ? `Cover of ${artist}` : "Cover" };
  }
  if (value === "original") return { kind: "original", text: "Original" };
  return null;
}
