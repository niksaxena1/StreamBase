import type { LibraryRow } from "./types";

/** Rules behind the "Needs attention" panel; the key is also the `attention` URL param. */
export const LIBRARY_ATTENTION_RULES = [
  "no_master",
  "no_isrc",
  "no_upc",
  "no_contract",
  "upcoming_no_folder",
  "unassigned",
] as const;

export type LibraryAttention = (typeof LIBRARY_ATTENTION_RULES)[number];

export const LIBRARY_ATTENTION_LABELS: Record<LibraryAttention, string> = {
  no_master: "Released without an M master",
  no_isrc: "Released without an ISRC",
  no_upc: "Released without a UPC",
  no_contract: "No signed contract on the drive",
  upcoming_no_folder: "Upcoming TG release with no drive folder",
  unassigned: "No entity assigned",
};

export function parseAttention(value: string | null | undefined): LibraryAttention | "" {
  return LIBRARY_ATTENTION_RULES.find((rule) => rule === value) ?? "";
}

const blank = (v: string | null) => !v || !v.trim();

/** A release counts as released on or before `today` (calendar dates, so a plain string compare works). */
const isReleased = (row: LibraryRow, today: string) => row.release_date !== null && row.release_date <= today;

/** Rows with no entity at all are treated like the "unassigned" entity. */
export const isUnassigned = (row: LibraryRow) => row.entity === null || row.entity === "unassigned";

export function matchesAttention(row: LibraryRow, rule: LibraryAttention, today: string): boolean {
  switch (rule) {
    case "no_master":
      return isReleased(row, today) && !blank(row.source_folder) && !row.has_m_master;
    case "no_isrc":
      return isReleased(row, today) && (row.entity === "tg" || row.entity === "p") && blank(row.isrc);
    case "no_upc":
      return isReleased(row, today) && (row.entity === "tg" || row.entity === "p") && blank(row.upc);
    case "no_contract":
      return row.entity === "tg" && !blank(row.source_folder) && !row.has_signed_contract;
    case "upcoming_no_folder":
      return row.entity === "tg" && row.release_date !== null && row.release_date > today && blank(row.source_folder);
    case "unassigned":
      return isUnassigned(row);
  }
}

export type AttentionCount = { rule: LibraryAttention; label: string; count: number };

/** Count per rule over all rows, with zero-count rules left out. */
export function attentionCounts(rows: LibraryRow[], today: string): AttentionCount[] {
  const counts = new Map<LibraryAttention, number>();
  for (const row of rows) {
    for (const rule of LIBRARY_ATTENTION_RULES) {
      if (matchesAttention(row, rule, today)) counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
  }
  return LIBRARY_ATTENTION_RULES.filter((rule) => (counts.get(rule) ?? 0) > 0).map((rule) => ({
    rule,
    label: LIBRARY_ATTENTION_LABELS[rule],
    count: counts.get(rule) ?? 0,
  }));
}
