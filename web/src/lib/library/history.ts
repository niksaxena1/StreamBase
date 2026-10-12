export type FieldChange = { field: string; before: string; after: string };

const FIELD_LABELS: Record<string, string> = {
  entity: "Entity",
  title: "File title",
  sheet_artist: "Artist",
  sheet_title: "Title",
  release_date: "Release date",
  distributor_account: "Distributor",
  label_genre: "Label / genre",
  originality: "Originality",
  exclusivity: "Exclusivity",
  comment_1: "Comment 1",
  comment_2: "Comment 2",
  cover_original_artist: "Cover original artist",
  new_distro: "New distro",
  genre: "Genre",
  non_exclusive_samples: "Splice samples",
  isrc: "ISRC",
  upc: "UPC",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

/** One value as short text: null/empty -> "—", booleans -> yes/no, arrays joined. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(describeValue).join(", ") : "—";
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Compact before -> after list for one change_log row. Only keys whose value
 * differs are listed; a missing `before` (e.g. a new track) shows every `after` key.
 */
export function diffChangeLog(before: unknown, after: unknown): FieldChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (JSON.stringify(b[key] ?? null) === JSON.stringify(a[key] ?? null)) continue;
    out.push({ field: key, before: describeValue(b[key]), after: describeValue(a[key]) });
  }
  return out;
}
