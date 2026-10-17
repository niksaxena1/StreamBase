import { LIBRARY_COLUMNS, LIBRARY_CSV_STREAM_COLUMNS, type LibraryRow } from "./types";
import { licensingCsv } from "./licensing";

/** One record per row: every overview column, then streams and the cover URL (blank until streams load). */
export function libraryCsvRows(rows: LibraryRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of LIBRARY_COLUMNS) record[column] = column === "licensing" ? JSON.stringify(row.licensing) : row[column];
    for (const column of LIBRARY_CSV_STREAM_COLUMNS) {
      record[column] = column === "Uniqode" || column === "Evenfall" ? licensingCsv(row.licensing, column) : row[column] ?? null;
    }
    return record;
  });
}

export function libraryCsvFilename(today: string): string {
  return `library-${today}.csv`;
}
