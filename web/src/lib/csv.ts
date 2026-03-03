function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = (() => {
    // Flatten arrays (e.g. artist_names, artist_ids, playlist_keys) into a readable string.
    // Use " | " to avoid commas that force CSV quoting in many viewers.
    if (Array.isArray(value)) {
      return value
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v))
        .join(" | ");
    }

    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    // Fallback for objects (rare in our exports).
    return JSON.stringify(value);
  })();

  // Escape quotes and wrap if needed
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function unionHeaders(rows: Array<Record<string, unknown>>): string[] {
  if (!rows.length) return [];
  const first = rows[0] ?? {};
  const headers: string[] = Object.keys(first).filter((k) => !k.startsWith("_"));
  const seen = new Set(headers);

  for (let i = 1; i < rows.length; i++) {
    for (const k of Object.keys(rows[i] ?? {})) {
      if (k.startsWith("_")) continue;
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }

  return headers;
}

function maybeSortForExport<T extends Record<string, unknown>>(rows: T[]): T[] {
  if (rows.length < 2) return rows;

  const hasKey = (k: string) => rows.every((r) => r && Object.prototype.hasOwnProperty.call(r, k));

  if (hasKey("date")) {
    const allStrings = rows.every((r) => typeof r.date === "string");
    if (allStrings) {
      return [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
  }

  if (hasKey("month")) {
    const allStrings = rows.every((r) => typeof r.month === "string");
    if (allStrings) {
      return [...rows].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    }
  }

  return rows;
}

export function toCsv(
  inputRows: Array<Record<string, unknown>>,
  opts?: { headers?: string[]; sortForExport?: boolean },
): string {
  const rows = (opts?.sortForExport ?? true) ? maybeSortForExport(inputRows) : inputRows;
  const headers = (opts?.headers?.length ? opts.headers : unionHeaders(rows)).map(String);

  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(","));

  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvCell(r?.[h])).join(","));
  }

  // Use \r\n for better Excel compatibility on Windows.
  return lines.join("\r\n");
}

export function downloadCsv(args: {
  filename: string;
  rows: Array<Record<string, unknown>>;
  headers?: string[];
  sortForExport?: boolean;
}): void {
  if (typeof window === "undefined") return;
  // Add UTF-8 BOM for Excel compatibility on Windows (prevents mojibake like "FoÃ­nix").
  const csv = `\ufeff${toCsv(args.rows, { headers: args.headers, sortForExport: args.sortForExport })}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = args.filename.toLowerCase().endsWith(".csv") ? args.filename : `${args.filename}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function slugifyForFilename(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function todayIsoDate(): string {
  // yyyy-mm-dd
  return new Date().toISOString().slice(0, 10);
}
