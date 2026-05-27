import { loadPlaylistsConfigStats } from "@/lib/playlists/loadPlaylistsConfigStats";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  try {
    const { statsMap, errorMessage } = await loadPlaylistsConfigStats();
    if (errorMessage) return apiJsonErr(errorMessage, 500);
    return apiJsonOk({ statsMap });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiJsonErr(msg, 500);
  }
}
