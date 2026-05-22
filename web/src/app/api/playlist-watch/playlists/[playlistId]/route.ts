import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess, requirePlaylistWatchAdmin } from "@/lib/playlistWatch/access";
import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ playlistId: string }> },
) {
  const params = await ctx.params;
  const playlistId = parseSpotifyPlaylistId(params.playlistId);
  if (!playlistId) return apiJsonErr("invalid_spotify_playlist", 400);

  const body = await readJsonBodyOptional(req);
  const action = String(body.action ?? "");
  const sb = await supabaseServer();
  const svc = supabaseService().schema("playlist_watch");

  if (action === "favorite") {
    const auth = await requirePlaylistWatchAccess(sb);
    if (!auth.ok) return auth.response;
    const isFavorite = Boolean(body.is_favorite);
    const { error } = await svc.from("user_playlist_marks").upsert(
      {
        user_id: auth.user.id,
        spotify_playlist_id: playlistId,
        is_favorite: isFavorite,
      },
      { onConflict: "user_id,spotify_playlist_id" },
    );
    if (error) return apiJsonErr(error.message, 500);
    return apiJsonOk({ spotify_playlist_id: playlistId, is_favorite: isFavorite });
  }

  if (action === "archive" || action === "unarchive") {
    const auth = await requirePlaylistWatchAdmin(sb);
    if (!auth.ok) return auth.response;
    const isArchive = action === "archive";
    const { error } = await svc
      .from("playlists")
      .update({
        watch_status: isArchive ? "archived" : "active",
        archived_at: isArchive ? new Date().toISOString() : null,
      })
      .eq("spotify_playlist_id", playlistId);
    if (error) return apiJsonErr(error.message, 500);
    return apiJsonOk({ spotify_playlist_id: playlistId, watch_status: isArchive ? "archived" : "active" });
  }

  return apiJsonErr("unsupported_action", 400);
}
