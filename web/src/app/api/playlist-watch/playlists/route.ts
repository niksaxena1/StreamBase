import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAdmin } from "@/lib/playlistWatch/access";
import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";
import { getPlaylistWithFollowers } from "@/lib/spotify";

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const playlistId = parseSpotifyPlaylistId(String(body.playlist ?? body.playlist_id ?? ""));
  if (!playlistId) return apiJsonErr("invalid_spotify_playlist", 400);

  let meta;
  try {
    meta = await getPlaylistWithFollowers(playlistId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiJsonErr(message, message.includes("404") ? 404 : 502);
  }

  const svc = supabaseService().schema("playlist_watch");
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const { error: playlistErr } = await svc.from("playlists").upsert(
    {
      spotify_playlist_id: meta.playlistId,
      display_name: meta.name,
      owner_spotify_id: meta.ownerId,
      owner_display_name: meta.ownerName,
      spotify_url: meta.externalUrl,
      image_url: meta.imageUrl,
      watch_status: "active",
      last_check_status: "ok",
      last_check_message: null,
      latest_follower_count: meta.followerCount,
      latest_snapshot_date: today,
      latest_checked_at: now,
      first_tracked_date: today,
      archived_at: null,
      created_by: auth.user.id,
    },
    { onConflict: "spotify_playlist_id" },
  );
  if (playlistErr) return apiJsonErr(playlistErr.message, 500);

  const { error: snapErr } = await svc.from("follower_snapshots").upsert(
    {
      date: today,
      spotify_playlist_id: meta.playlistId,
      follower_count: meta.followerCount,
      source: "spotify_api",
      checked_at: now,
    },
    { onConflict: "date,spotify_playlist_id" },
  );
  if (snapErr) return apiJsonErr(snapErr.message, 500);

  return apiJsonOk({ playlist: meta });
}
