import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { enrichPlaylistsWithFollowerCounts, getSpotifyUser, listUserOwnedPlaylists } from "@/lib/spotify";

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

  let spotifyPlaylists;
  let ownerProfile;
  try {
    const [listed, profile] = await Promise.all([
      listUserOwnedPlaylists(id),
      getSpotifyUser(id).catch(() => ({
        userId: id,
        displayName: null,
        imageUrl: null,
      })),
    ]);
    let enriched = listed.playlists;
    try {
      enriched = await enrichPlaylistsWithFollowerCounts(listed.playlists);
    } catch {
      // Keep list usable even if follower hydration fails.
    }
    spotifyPlaylists = { playlists: enriched, truncated: listed.truncated };
    ownerProfile = profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("404") ? 404 : 502;
    return apiJsonErr(message, status);
  }

  const svc = supabaseService().schema("playlist_watch");
  const { data: trackedRows, error: trackedErr } = await svc
    .from("playlists")
    .select("spotify_playlist_id,watch_status,latest_follower_count")
    .eq("owner_spotify_id", id);
  if (trackedErr) return apiJsonErr(trackedErr.message, 500);

  const trackedById = new Map(
    (trackedRows ?? []).map((row) => [
      row.spotify_playlist_id as string,
      {
        watchStatus: row.watch_status as "active" | "archived",
        followerCount:
          typeof row.latest_follower_count === "number" ? row.latest_follower_count : null,
      },
    ]),
  );

  const playlists = spotifyPlaylists.playlists
    .map((playlist) => {
      const tracked = trackedById.get(playlist.playlistId);
      const watchStatus = tracked?.watchStatus ?? null;
      const followerCount = playlist.followerCount ?? tracked?.followerCount ?? null;
      return {
        spotifyPlaylistId: playlist.playlistId,
        displayName: playlist.name,
        imageUrl: playlist.imageUrl,
        spotifyUrl: playlist.externalUrl,
        followerCount,
        watchStatus,
        isTracked: watchStatus !== null,
      };
    })
    .sort((a, b) => (b.followerCount ?? -1) - (a.followerCount ?? -1));

  return apiJsonOk({
    ownerId: id,
    owner: ownerProfile,
    playlists,
    truncated: spotifyPlaylists.truncated,
  });
}
