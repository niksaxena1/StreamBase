import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data, error } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true })
    .limit(1000);

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const playlists = (data ?? []).map((p: { playlist_key?: unknown; display_name?: unknown; spotify_playlist_image_url?: unknown }) => ({
    playlist_key: String(p.playlist_key ?? ""),
    display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
    spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
  }));

  return apiJsonOk({ playlists });
}
