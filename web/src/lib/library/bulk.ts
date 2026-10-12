/** Fields the bulk bar can change; the key is the `update_track` key. */
export const BULK_FIELDS = [
  { key: "entity", label: "Entity", clearable: false },
  { key: "distributor_account", label: "Distributor", clearable: true },
  { key: "label_genre", label: "Label / Genre", clearable: true },
  { key: "originality", label: "Originality", clearable: true },
  { key: "exclusivity", label: "Exclusivity", clearable: true },
] as const;

export type BulkFieldKey = (typeof BULK_FIELDS)[number]["key"];

const BULK_FIELD_KEYS: readonly string[] = BULK_FIELDS.map((f) => f.key);

/** Ids per RPC call. */
export const BULK_CHUNK_SIZE = 500;
/** The most ids one request may carry (the RPC's own limit is per call). */
export const BULK_MAX_IDS = 3000;

export function chunkIds<T>(ids: T[], size: number = BULK_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

export type BulkChanges = Partial<Record<BulkFieldKey, string | null>>;

/** `{ [field]: value }` for the RPC; blank text clears a clearable field. Null when there is nothing valid to send. */
export function buildBulkChanges(field: BulkFieldKey, value: string): BulkChanges | null {
  const spec = BULK_FIELDS.find((f) => f.key === field);
  if (!spec) return null;
  const text = value.trim();
  if (!text) return spec.clearable ? { [field]: null } : null;
  return { [field]: text };
}

/** Server-side check of a change set from the client: bulk fields only, right types, entity never blank. */
export function validateBulkChanges(changes: unknown): { ok: true; changes: BulkChanges } | { ok: false; error: string } {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { ok: false, error: "Nothing to change" };
  const out: BulkChanges = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (!BULK_FIELD_KEYS.includes(key)) return { ok: false, error: `Can't bulk edit "${key}"` };
    if (value !== null && typeof value !== "string") return { ok: false, error: `Invalid value for "${key}"` };
    const field = key as BulkFieldKey;
    const text = typeof value === "string" ? value.trim() : "";
    if (field === "entity") {
      if (!text) return { ok: false, error: "Pick an entity" };
      out.entity = text;
    } else {
      out[field] = text ? text : null;
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, changes: out };
}

/** Unique, well-formed catalog IDs in first-seen order; null if any is malformed, none given, or too many. */
export function cleanBulkIds(ids: unknown, idPattern: RegExp): string[] | null {
  if (!Array.isArray(ids)) return null;
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !idPattern.test(id)) return null;
    seen.add(id);
  }
  return seen.size > 0 && seen.size <= BULK_MAX_IDS ? [...seen] : null;
}

/** "Change Entity to Legacy for 214 releases?" / "Clear Distributor for 1 release?" */
export function bulkConfirmText(field: BulkFieldKey, displayValue: string, count: number): string {
  const label = BULK_FIELDS.find((f) => f.key === field)?.label ?? field;
  const noun = count === 1 ? "release" : "releases";
  const n = count.toLocaleString("en-US");
  return displayValue.trim() ? `Change ${label} to ${displayValue} for ${n} ${noun}?` : `Clear ${label} for ${n} ${noun}?`;
}

export type BulkRunResult = { updated: number; processed: number; error: string | null };

/**
 * Sends the ids to `callRpc` in chunks of `BULK_CHUNK_SIZE`, one after the other, adding up the
 * number of tracks it reports as changed. Stops at the first failing chunk and says how far it got,
 * so the caller can report a partial run.
 */
export async function runBulkUpdate(
  ids: string[],
  callRpc: (chunk: string[]) => Promise<{ changed: number } | { error: string }>,
): Promise<BulkRunResult> {
  let updated = 0;
  let processed = 0;
  for (const chunk of chunkIds(ids)) {
    let res: { changed: number } | { error: string };
    try {
      res = await callRpc(chunk);
    } catch (error) {
      res = { error: error instanceof Error ? error.message : "Update failed" };
    }
    if ("error" in res) return { updated, processed, error: res.error };
    updated += res.changed;
    processed += chunk.length;
  }
  return { updated, processed, error: null };
}
