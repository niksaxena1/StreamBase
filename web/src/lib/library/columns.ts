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
};

/** Every table column, in display order. Header and rows are both drawn from this list. */
export const LIBRARY_TABLE_COLUMNS: readonly LibraryColumn[] = [
  { id: "select", label: "", track: "20px", minPx: 20 },
  { id: "cover", label: "", track: "32px", minPx: 32 },
  { id: "release", label: "Release date", track: "104px", minPx: 104, sort: "release" },
  { id: "artist", label: "Artist", track: "minmax(140px,1.2fr)", minPx: 140, sort: "artist" },
  { id: "title", label: "Title", track: "minmax(160px,1.6fr)", minPx: 160, sort: "title" },
  { id: "originality", label: "Orig.", track: "36px", minPx: 36, align: "center" },
  { id: "entity", label: "Entity", track: "96px", minPx: 96 },
  { id: "distributor", label: "Distributor", track: "120px", minPx: 120 },
  { id: "labelGenre", label: "Label / Genre", track: "120px", minPx: 120 },
  { id: "comment1", label: "Comment 1", track: "minmax(120px,1fr)", minPx: 120 },
  { id: "comment2", label: "Comment 2", track: "minmax(120px,1fr)", minPx: 120 },
  { id: "isrc", label: "ISRC", track: "128px", minPx: 128 },
  { id: "upc", label: "UPC", track: "116px", minPx: 116 },
  { id: "streams", label: "Streams", track: "72px", minPx: 72, align: "right", sort: "streams" },
  { id: "streams7d", label: "7 days", track: "64px", minPx: 64, align: "right", sort: "streams7d" },
  { id: "length", label: "Length", track: "56px", minPx: 56, align: "right", sort: "duration" },
  { id: "master", label: "Master", track: "56px", minPx: 56, align: "center" },
  { id: "drive", label: "Drive", track: "60px", minPx: 60, align: "center" },
  { id: "catalog", label: "Catalog ID", track: "92px", minPx: 92, sort: "catalog" },
];

export const LIBRARY_GRID_COLUMNS = LIBRARY_TABLE_COLUMNS.map((c) => c.track).join(" ");

/** Narrowest table width: every column at its minimum, plus the 12 px gaps and side padding. */
export const LIBRARY_TABLE_MIN_WIDTH = LIBRARY_TABLE_COLUMNS.reduce((sum, c) => sum + c.minPx, 0) + 12 * (LIBRARY_TABLE_COLUMNS.length - 1) + 24;

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
