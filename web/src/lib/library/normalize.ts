import type { LibraryCode, LibraryDistributor, LibraryEntity, LibraryFile, LibraryHistoryEntry, LibraryRow } from "./types";

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

const numArray = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map(num).filter((n): n is number => n !== null);
  return out.length ? out : null;
};

/** Raw `track_overview` row (PostgREST JSON) -> typed row. */
export function normalizeOverviewRow(raw: Raw): LibraryRow {
  return {
    catalog_id: String(raw.catalog_id ?? ""),
    entity: str(raw.entity),
    release_date: str(raw.release_date),
    sheet_artist: str(raw.sheet_artist),
    sheet_title: str(raw.sheet_title),
    title: str(raw.title),
    artists: strArray(raw.artists),
    distributor_account: str(raw.distributor_account),
    status: str(raw.status),
    isrc: str(raw.isrc),
    upc: str(raw.upc),
    master_duration_s: num(raw.master_duration_s),
    has_m_master: raw.has_m_master === true,
    non_exclusive_samples: raw.non_exclusive_samples === true,
    dropbox_link: str(raw.dropbox_link),
    source_folder: str(raw.source_folder),
    label_genre: str(raw.label_genre),
    originality: str(raw.originality),
    exclusivity: str(raw.exclusivity),
    comment_1: str(raw.comment_1),
    comment_2: str(raw.comment_2),
    cover_original_artist: str(raw.cover_original_artist),
    new_distro: str(raw.new_distro),
    genre: str(raw.genre),
    file_count: num(raw.file_count) ?? 0,
    updated_at: str(raw.updated_at),
  };
}

export function normalizeEntity(raw: Raw): LibraryEntity {
  return {
    code: String(raw.code ?? ""),
    name: str(raw.name) ?? String(raw.code ?? "").toUpperCase(),
    active: raw.active !== false,
    catalog_id_prefix: str(raw.catalog_id_prefix),
  };
}

export function normalizeDistributor(raw: Raw): LibraryDistributor {
  return { name: String(raw.name ?? ""), owner: str(raw.owner) };
}

export function normalizeFile(raw: Raw): LibraryFile {
  return {
    id: typeof raw.id === "number" ? raw.id : String(raw.id ?? ""),
    catalog_id: String(raw.catalog_id ?? ""),
    rel_path: String(raw.rel_path ?? ""),
    role: String(raw.role ?? "other"),
    m_version: numArray(raw.m_version),
    bytes: num(raw.bytes),
    duration_s: num(raw.duration_s),
    sample_rate: num(raw.sample_rate),
    bit_depth: num(raw.bit_depth),
    channels: num(raw.channels),
    width: num(raw.width),
    height: num(raw.height),
    dropbox_path: str(raw.dropbox_path),
  };
}

export function normalizeCode(raw: Raw, key: "isrc" | "upc"): LibraryCode {
  return { code: String(raw[key] ?? ""), is_primary: raw.is_primary === true, source: str(raw.source) };
}

export function normalizeHistory(raw: Raw): LibraryHistoryEntry {
  return {
    id: typeof raw.id === "number" ? raw.id : String(raw.id ?? ""),
    at: String(raw.at ?? ""),
    actor: str(raw.actor),
    action: str(raw.action),
    target: str(raw.target),
    before: raw.before ?? null,
    after: raw.after ?? null,
  };
}

/** Primary code first, then the rest in source order. */
export function sortCodes(codes: LibraryCode[]): LibraryCode[] {
  return [...codes].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
}

/** Insert / replace rows by catalog ID, keeping the row with the newer `updated_at`. */
export function mergeRows(base: LibraryRow[], overrides: Map<string, LibraryRow>): LibraryRow[] {
  if (overrides.size === 0) return base;
  const seen = new Set<string>();
  const out = base.map((row) => {
    seen.add(row.catalog_id);
    const over = overrides.get(row.catalog_id);
    if (!over) return row;
    return (over.updated_at ?? "") >= (row.updated_at ?? "") ? over : row;
  });
  for (const [id, row] of overrides) if (!seen.has(id)) out.push(row);
  return out;
}
