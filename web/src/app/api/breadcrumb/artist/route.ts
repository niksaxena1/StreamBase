import { supabaseServer } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";

export const revalidate = 86400;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artist_id");

  if (!artistId) {
    return apiJsonErr("missing artist_id", 400);
  }

  try {
    const sb = await supabaseServer();
    const auth = await requireUser(sb);
    if (!auth.ok) return auth.response;

    const { data: tracks } = await sb
      .from("tracks")
      .select("spotify_artist_names,spotify_artist_ids")
      .contains("spotify_artist_ids", [artistId])
      .limit(1);

    const artistName = tracks?.[0]?.spotify_artist_names?.[0] ?? null;

    return apiJsonOk({ artistName });
  } catch (error) {
    logError("Breadcrumb artist error", error);
    return apiJsonErr("lookup failed", 500);
  }
}
