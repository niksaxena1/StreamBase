import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";
import { getAdminUserDatasetContext } from "@/lib/datasetContext.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARTISTS = 12000;

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
  };

  const rawIds = Array.isArray(body.artistIds)
    ? body.artistIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
    : [];
  const artistIds = [...new Set(rawIds)].slice(0, MAX_ARTISTS);

  const playlistKey =
    typeof body.playlistKey === "string" && body.playlistKey.trim() ? body.playlistKey.trim() : null;
  const hideNonPrimary = Boolean(body.hideNonPrimary);

  if (!artistIds.length) {
    return apiJsonOk({
      trackCount: 0,
      totalStreams: 0,
      dailyStreams: 0,
    });
  }

  const svc = supabaseService();
  const { datasetMode } = await getAdminUserDatasetContext(svc, auth.user.id);
  const rpcArgs = {
    p_artist_ids: artistIds,
    p_playlist_key: playlistKey ?? undefined,
    p_hide_non_primary: hideNonPrimary,
  };
  const { data, error } =
    datasetMode === "competitor"
      ? await svc.schema("competitor").rpc("network_selection_scoped_track_totals", rpcArgs)
      : await svc.rpc("network_selection_scoped_track_totals", rpcArgs);

  if (error) {
    console.error("network_selection_scoped_track_totals:", error);
    return apiJsonErr(error.message, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const r = row as {
    track_count?: number | string | null;
    total_streams?: number | string | null;
    daily_streams?: number | string | null;
  } | null;

  return apiJsonOk({
    trackCount: Number(r?.track_count ?? 0) || 0,
    totalStreams: Number(r?.total_streams ?? 0) || 0,
    dailyStreams: Number(r?.daily_streams ?? 0) || 0,
  });
}
