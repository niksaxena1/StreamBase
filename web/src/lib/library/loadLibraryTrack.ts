import { catalogService } from "@/lib/supabase/catalogService";

import {
  normalizeCode,
  normalizeFile,
  normalizeHistory,
  normalizeOverviewRow,
  sortCodes,
} from "./normalize";
import { fetchAllPages } from "./paging";
import type { LibraryRow, LibraryTrackDetail } from "./types";

type RawRow = Record<string, unknown>;

const FILE_COLUMNS =
  "id,catalog_id,rel_path,role,m_version,bytes,duration_s,sample_rate,bit_depth,channels,width,height,dropbox_path";

const HISTORY_LIMIT = 100;

/**
 * Files, extra codes and history for one track. Read fresh (not cached) so the
 * panel shows the change you just saved.
 */
export async function loadLibraryTrackDetail(catalogId: string): Promise<LibraryTrackDetail> {
  const db = catalogService();
  const [files, isrcs, upcs, history] = await Promise.all([
    fetchAllPages<RawRow>(async (from, to) => {
      const { data, error } = await db
        .from("files")
        .select(FILE_COLUMNS)
        .eq("catalog_id", catalogId)
        .order("rel_path", { ascending: true })
        .range(from, to);
      return { data: data as RawRow[] | null, error };
    }),
    db.from("track_isrcs").select("isrc,is_primary,source").eq("catalog_id", catalogId),
    db.from("track_upcs").select("upc,is_primary,source").eq("catalog_id", catalogId),
    db
      .from("change_log")
      .select("id,at,actor,action,target,before,after")
      .eq("target", catalogId)
      .order("at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (isrcs.error) throw new Error(isrcs.error.message);
  if (upcs.error) throw new Error(upcs.error.message);
  if (history.error) throw new Error(history.error.message);

  return {
    files: files.map(normalizeFile),
    isrcs: sortCodes(((isrcs.data ?? []) as RawRow[]).map((r) => normalizeCode(r, "isrc"))),
    upcs: sortCodes(((upcs.data ?? []) as RawRow[]).map((r) => normalizeCode(r, "upc"))),
    history: ((history.data ?? []) as RawRow[]).map(normalizeHistory),
  };
}

/** One fresh overview row (used right after a save or create). */
export async function loadLibraryOverviewRow(catalogId: string): Promise<LibraryRow | null> {
  const { data, error } = await catalogService()
    .from("track_overview")
    .select("*")
    .eq("catalog_id", catalogId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeOverviewRow(data as RawRow) : null;
}
