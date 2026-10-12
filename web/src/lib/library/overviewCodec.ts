import { normalizeOverviewRow } from "./normalize";
import { LIBRARY_COLUMNS, type LibraryRow } from "./types";

/**
 * Compact form of the overview for the Next data cache (one entry holds the whole
 * list and Next refuses entries over 2 MB). Rows become plain arrays in
 * `LIBRARY_COLUMNS` order, which drops the repeated key names (about half the size).
 */
export type EncodedOverview = unknown[][];

export function encodeOverview(rows: LibraryRow[]): EncodedOverview {
  return rows.map((row) => LIBRARY_COLUMNS.map((column) => row[column]));
}

export function decodeOverview(encoded: EncodedOverview): LibraryRow[] {
  return encoded.map((tuple) => {
    const raw: Record<string, unknown> = {};
    LIBRARY_COLUMNS.forEach((column, i) => {
      raw[column] = tuple[i];
    });
    return normalizeOverviewRow(raw);
  });
}

/** Next's data cache rejects entries over 2 MiB (2,097,152 bytes); keep a margin. Bigger overviews are read uncached. */
export const MAX_CACHED_OVERVIEW_BYTES = 1_800_000;

/** Serialized size of the encoded overview, in bytes. */
export function encodedOverviewBytes(encoded: EncodedOverview): number {
  return new TextEncoder().encode(JSON.stringify(encoded)).length;
}
