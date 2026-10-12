import { logError } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { CATALOG_ENV_VARS, catalogConfigured, catalogService } from "@/lib/supabase/catalogService";
import { queryErrorMessage } from "@/lib/supabase/rpcErrors";

import { LIBRARY_CACHE_TAG, LIBRARY_CACHE_TTL_S } from "./cache";
import { normalizeDistributor, normalizeEntity, normalizeOverviewRow } from "./normalize";
import {
  MAX_CACHED_OVERVIEW_BYTES,
  decodeOverview,
  encodeOverview,
  encodedOverviewBytes,
  type EncodedOverview,
} from "./overviewCodec";
import { fetchAllByKeyset } from "./paging";
import { LIBRARY_COLUMNS, type LibraryDistributor, type LibraryEntity, type LibraryRow } from "./types";

export type LibraryLoadResult =
  | { status: "not_configured"; envVars: readonly string[] }
  | { status: "error"; message: string }
  | {
      status: "ok";
      rows: LibraryRow[];
      entities: LibraryEntity[];
      distributors: LibraryDistributor[];
    };

type RawRow = Record<string, unknown>;

const OVERVIEW_COLUMNS = LIBRARY_COLUMNS.join(",");
const OVERSIZE_MESSAGE = "library overview too large to cache";

/** Set once the overview outgrows the cache limit, so later requests skip the wasted attempt. */
let overviewCacheDisabled = false;

/** One uncached read of the whole overview, paged by catalog_id so pages can't gap or overlap. */
async function readOverviewRows(): Promise<LibraryRow[]> {
  const db = catalogService();
  const raw = await fetchAllByKeyset<RawRow>(
    async (after, limit) => {
      let query = db.from("track_overview").select(OVERVIEW_COLUMNS).order("catalog_id", { ascending: true });
      if (after !== null) query = query.gt("catalog_id", after);
      const { data, error } = await query.limit(limit);
      return { data: (data as unknown as RawRow[] | null) ?? null, error };
    },
    (row) => String(row.catalog_id ?? ""),
  );
  const seen = new Set<string>();
  const rows: LibraryRow[] = [];
  for (const r of raw) {
    const row = normalizeOverviewRow(r);
    if (!row.catalog_id || seen.has(row.catalog_id)) continue;
    seen.add(row.catalog_id);
    rows.push(row);
  }
  return rows;
}

/**
 * The overview comes from one consistent read. It is cached as a single compact
 * entry (so every row is the same age); if that would exceed Next's 2 MB
 * data-cache limit it is simply not cached. It is admin-only and small.
 */
async function loadOverviewRows(): Promise<LibraryRow[]> {
  if (!overviewCacheDisabled) {
    const cached = await cachedQuery<EncodedOverview>(
      async () => {
        const encoded = encodeOverview(await readOverviewRows());
        if (encodedOverviewBytes(encoded) > MAX_CACHED_OVERVIEW_BYTES) throw new Error(OVERSIZE_MESSAGE);
        return { data: encoded, error: null };
      },
      `library-overview:${OVERVIEW_COLUMNS}`,
      LIBRARY_CACHE_TTL_S,
      [LIBRARY_CACHE_TAG],
    );
    if (!cached.error) return decodeOverview(cached.data ?? []);
    if (cached.error.message !== OVERSIZE_MESSAGE) throw new Error(cached.error.message);
    overviewCacheDisabled = true;
  }
  return readOverviewRows();
}

async function loadSmallTable(table: "entities" | "distributor_accounts", columns: string, order: string) {
  const res = await cachedQuery<RawRow[]>(
    async () => {
      const { data, error } = await catalogService().from(table).select(columns).order(order, { ascending: true });
      return { data: (data as RawRow[] | null) ?? null, error: error ? { message: error.message, code: error.code } : null };
    },
    `library-${table}`,
    LIBRARY_CACHE_TTL_S,
    [LIBRARY_CACHE_TAG],
  );
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

/** Everything the Library page needs. Never throws: failures come back as a status. */
export async function loadLibrary(): Promise<LibraryLoadResult> {
  if (!catalogConfigured()) return { status: "not_configured", envVars: CATALOG_ENV_VARS };
  try {
    const [rows, entities, distributors] = await Promise.all([
      loadOverviewRows(),
      loadSmallTable("entities", "code,name,active,catalog_id_prefix", "code"),
      loadSmallTable("distributor_accounts", "name,owner", "name"),
    ]);
    return {
      status: "ok",
      rows,
      entities: entities.map(normalizeEntity),
      distributors: distributors.map(normalizeDistributor).filter((d) => d.name),
    };
  } catch (error) {
    logError("Library load failed", error);
    return { status: "error", message: queryErrorMessage(error) };
  }
}
