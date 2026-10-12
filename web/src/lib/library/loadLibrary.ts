import { logError } from "@/lib/logger";
import { cachedQuery } from "@/lib/supabase/cache";
import { CATALOG_ENV_VARS, catalogConfigured, catalogService } from "@/lib/supabase/catalogService";
import { queryErrorMessage } from "@/lib/supabase/rpcErrors";

import { LIBRARY_CACHE_TAG, LIBRARY_CACHE_TTL_S } from "./cache";
import { normalizeDistributor, normalizeEntity, normalizeOverviewRow } from "./normalize";
import { fetchAllPages, POSTGREST_PAGE_SIZE } from "./paging";
import type { LibraryDistributor, LibraryEntity, LibraryRow } from "./types";

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

/**
 * One cached request per PostgREST page, so each cache entry stays well under
 * Next's 2 MB data-cache item limit. All entries share the `catalog` tag.
 */
async function loadOverviewRows(): Promise<LibraryRow[]> {
  const raw = await fetchAllPages<RawRow>(async (from, to) => {
    const res = await cachedQuery<RawRow[]>(
      async () => {
        const { data, error } = await catalogService()
          .from("track_overview")
          .select("*")
          .order("catalog_id", { ascending: true })
          .range(from, to);
        return { data: (data as RawRow[] | null) ?? null, error: error ? { message: error.message, code: error.code } : null };
      },
      `library-overview-${from / POSTGREST_PAGE_SIZE}`,
      LIBRARY_CACHE_TTL_S,
      [LIBRARY_CACHE_TAG],
    );
    return res;
  });
  // A page boundary can shift between cache entries; keep the first copy of each ID.
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
