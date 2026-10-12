import { LIBRARY_COLUMNS, type LibraryRow } from "./types";

/** One record per row with every overview column, in export order. */
export function libraryCsvRows(rows: LibraryRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of LIBRARY_COLUMNS) record[column] = row[column];
    return record;
  });
}

export function libraryCsvFilename(today: string): string {
  return `library-${today}.csv`;
}
