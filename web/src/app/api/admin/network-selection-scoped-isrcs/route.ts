import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";
import { getAdminUserDatasetContext } from "@/lib/datasetContext.server";
import { POSTGREST_PAGE_SIZE } from "@/lib/library/paging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARTISTS = 12000;
const PAGE_LIMIT = 8000;

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as {
    artistIds?: unknown;
    playlistKey?: unknown;
    hideNonPrimary?: unknown;
    offset?: unknown;
  };

  const rawIds = Array.isArray(body.artistIds)
    ? body.artistIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
    : [];
  const artistIds = [...new Set(rawIds)].slice(0, MAX_ARTISTS);

  const playlistKey =
    typeof body.playlistKey === "string" && body.playlistKey.trim() ? body.playlistKey.trim() : null;
  const hideNonPrimary = Boolean(body.hideNonPrimary);
  const offsetRaw = typeof body.offset === "number" && Number.isFinite(body.offset) ? Math.floor(body.offset) : 0;
  const offset = Math.max(0, offsetRaw);

  if (!artistIds.length) {
    return apiJsonOk({ isrcs: [] as string[], hasMore: false, nextOffset: null as number | null });
  }

  const svc = supabaseService();
  const { datasetMode } = await getAdminUserDatasetContext(svc, auth.user.id);
  const rpcArgs = {
    p_artist_ids: artistIds,
    p_playlist_key: playlistKey ?? undefined,
    p_hide_non_primary: hideNonPrimary,
  };
  const flat: string[] = [];
  const requestedRows = PAGE_LIMIT + 1;
  for (let fetched = 0; fetched < requestedRows;) {
    const batchLimit = Math.min(POSTGREST_PAGE_SIZE, requestedRows - fetched);
    const rpc = datasetMode === "competitor"
      ? svc.schema("competitor").rpc("network_selection_scoped_isrcs", {
          ...rpcArgs, p_limit: batchLimit, p_offset: offset + fetched,
        })
      : svc.rpc("network_selection_scoped_isrcs", {
          ...rpcArgs, p_limit: batchLimit, p_offset: offset + fetched,
        });
    const { data, error } = await rpc;
    if (error) {
      console.error("network_selection_scoped_isrcs:", error);
      return apiJsonErr(error.message, 500);
    }
    const rows = (data ?? []) as Array<{ isrc: string } | string>;
    flat.push(...rows.map((r) => (typeof r === "string" ? r : r.isrc)).filter(Boolean));
    if (rows.length < batchLimit) break;
    fetched += batchLimit;
  }
  const hasMore = flat.length > PAGE_LIMIT;
  const isrcs = hasMore ? flat.slice(0, PAGE_LIMIT) : flat;

  return apiJsonOk({ isrcs, hasMore, nextOffset: hasMore ? offset + PAGE_LIMIT : null });
}
