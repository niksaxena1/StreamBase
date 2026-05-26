import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { getSpotifyUser } from "@/lib/spotify";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ownerId: string }> },
) {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const { ownerId } = await ctx.params;
  const id = String(ownerId ?? "").trim();
  if (!id) return apiJsonErr("invalid_owner_id", 400);

  try {
    const owner = await getSpotifyUser(id);
    return apiJsonOk({ owner });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("404") ? 404 : 502;
    return apiJsonErr(message, status);
  }
}
