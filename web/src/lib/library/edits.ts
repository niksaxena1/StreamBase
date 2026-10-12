import { isrcError, normalizeIsrc, normalizeUpc, upcError } from "./codes";
import { isValidIsoDate } from "./format";
import type { LibraryRow } from "./types";

/** Text fields that map straight onto `update_track` keys. Empty text is stored as null. */
export const TEXT_FIELDS = [
  "sheet_artist",
  "sheet_title",
  "label_genre",
  "originality",
  "exclusivity",
  "comment_1",
  "comment_2",
  "cover_original_artist",
  "new_distro",
  "genre",
] as const;

export type TextField = (typeof TEXT_FIELDS)[number];

/** Keys the `update_track` RPC accepts. */
export const EDITABLE_KEYS = [
  "entity",
  "title",
  ...TEXT_FIELDS,
  "release_date",
  "distributor_account",
  "non_exclusive_samples",
  "isrc",
  "upc",
] as const;

export type LibraryDraft = {
  entity: string;
  sheet_artist: string;
  sheet_title: string;
  release_date: string;
  distributor_account: string;
  label_genre: string;
  originality: string;
  exclusivity: string;
  cover_original_artist: string;
  new_distro: string;
  genre: string;
  comment_1: string;
  comment_2: string;
  non_exclusive_samples: boolean;
  isrc: string;
  upc: string;
};

export type LibraryChanges = Record<string, string | boolean | null>;

/** Form values for a row: nulls become empty strings. */
export function draftFromRow(row: LibraryRow): LibraryDraft {
  return {
    entity: row.entity ?? "",
    sheet_artist: row.sheet_artist ?? "",
    sheet_title: row.sheet_title ?? "",
    release_date: row.release_date ?? "",
    distributor_account: row.distributor_account ?? "",
    label_genre: row.label_genre ?? "",
    originality: row.originality ?? "",
    exclusivity: row.exclusivity ?? "",
    cover_original_artist: row.cover_original_artist ?? "",
    new_distro: row.new_distro ?? "",
    genre: row.genre ?? "",
    comment_1: row.comment_1 ?? "",
    comment_2: row.comment_2 ?? "",
    non_exclusive_samples: row.non_exclusive_samples,
    isrc: row.isrc ?? "",
    upc: row.upc ?? "",
  };
}

const textOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/**
 * Only the keys whose value differs from the saved row, ready for `update_track`.
 * Text is trimmed, empty text becomes null, and ISRC / UPC go through normalisation
 * (an empty string clears them, as the RPC expects).
 */
export function buildTrackChanges(original: LibraryRow, draft: LibraryDraft): LibraryChanges {
  const changes: LibraryChanges = {};

  if (draft.entity && draft.entity !== (original.entity ?? "")) changes.entity = draft.entity;

  for (const key of TEXT_FIELDS) {
    const next = textOrNull(draft[key]);
    if (next !== textOrNull(original[key])) changes[key] = next;
  }

  const nextDate = textOrNull(draft.release_date);
  if (nextDate !== textOrNull(original.release_date)) changes.release_date = nextDate;

  const nextDistributor = textOrNull(draft.distributor_account);
  if (nextDistributor !== textOrNull(original.distributor_account)) changes.distributor_account = nextDistributor;

  if (draft.non_exclusive_samples !== original.non_exclusive_samples) {
    changes.non_exclusive_samples = draft.non_exclusive_samples;
  }

  const nextIsrc = normalizeIsrc(draft.isrc);
  if (nextIsrc !== normalizeIsrc(original.isrc)) changes.isrc = nextIsrc;

  const nextUpc = normalizeUpc(draft.upc);
  if (nextUpc !== normalizeUpc(original.upc)) changes.upc = nextUpc;

  return changes;
}

export type DraftErrors = Partial<Record<keyof LibraryDraft, string>>;

/** Client-side checks run before saving. Returns an empty object when the draft is fine. */
export function validateDraft(draft: LibraryDraft, original?: LibraryRow): DraftErrors {
  const errors: DraftErrors = {};
  const date = draft.release_date.trim();
  if (date && !isValidIsoDate(date)) errors.release_date = "Enter a valid date";
  const isrc = isrcError(draft.isrc);
  if (isrc) errors.isrc = isrc;
  const upc = upcError(draft.upc);
  if (upc) errors.upc = upc;
  if (!draft.entity.trim()) errors.entity = "Pick an entity";
  // Only block an emptied name if the saved row had one.
  if (!draft.sheet_artist.trim() && (!original || original.sheet_artist)) errors.sheet_artist = "Artist is required";
  if (!draft.sheet_title.trim() && (!original || original.sheet_title)) errors.sheet_title = "Title is required";
  return errors;
}

/** Fields for a new release (the "Add release" form). */
export type NewReleaseDraft = {
  entity: string;
  sheet_artist: string;
  sheet_title: string;
  release_date: string;
  distributor_account: string;
};

export function validateNewRelease(draft: NewReleaseDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.entity.trim()) errors.entity = "Pick an entity";
  if (!draft.sheet_artist.trim()) errors.sheet_artist = "Artist is required";
  if (!draft.sheet_title.trim()) errors.sheet_title = "Title is required";
  const date = draft.release_date.trim();
  if (date && !isValidIsoDate(date)) errors.release_date = "Enter a valid date";
  return errors;
}

/** The `p_fields` payload for `create_track`; only filled-in fields are sent. */
export function buildNewReleaseFields(draft: NewReleaseDraft): LibraryChanges {
  const fields: LibraryChanges = {
    sheet_artist: draft.sheet_artist.trim(),
    sheet_title: draft.sheet_title.trim(),
  };
  const date = textOrNull(draft.release_date);
  if (date) fields.release_date = date;
  const distributor = textOrNull(draft.distributor_account);
  if (distributor) fields.distributor_account = distributor;
  return fields;
}

/**
 * Checks a change set before it reaches the database (used by the server action):
 * known keys only, right value types, valid ISRC / UPC / date.
 */
export function validateChanges(changes: unknown): { ok: true; changes: LibraryChanges } | { ok: false; error: string } {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { ok: false, error: "Nothing to save" };
  const input = changes as Record<string, unknown>;
  const allowed = new Set<string>(EDITABLE_KEYS);
  const out: LibraryChanges = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) return { ok: false, error: `Can't edit "${key}"` };
    if (key === "non_exclusive_samples") {
      if (typeof value !== "boolean") return { ok: false, error: "Splice samples must be yes or no" };
      out[key] = value;
      continue;
    }
    if (value !== null && typeof value !== "string") return { ok: false, error: `Invalid value for "${key}"` };
    if (key === "isrc") {
      const err = isrcError(value ?? "");
      if (err) return { ok: false, error: err };
      out[key] = normalizeIsrc(value);
    } else if (key === "upc") {
      const err = upcError(value ?? "");
      if (err) return { ok: false, error: err };
      out[key] = normalizeUpc(value);
    } else if (key === "release_date") {
      if (value !== null && !isValidIsoDate(value)) return { ok: false, error: "Enter a valid date" };
      out[key] = value;
    } else if (key === "entity") {
      if (!value || !value.trim()) return { ok: false, error: "Pick an entity" };
      out[key] = value;
    } else {
      out[key] = value;
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to save" };
  return { ok: true, changes: out };
}
