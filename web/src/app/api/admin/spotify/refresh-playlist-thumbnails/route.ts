import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

type Body = {
  cursor?: string | null;
  limit?: number;
  force?: boolean;
};

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const raw = await readJsonBodyOptional(req);
  const body = raw as Body;

  const cursor = (body.cursor ?? null) as string | null;
  const limit = Math.max(1, Math.min(Number(body.limit ?? 5) || 5, 10));
  const force = Boolean(body.force ?? true);

  const svc = supabaseService();

  let q = svc
    .from("playlists")
    .select("playlist_key,spotify_playlist_id,spotify_playlist_image_url")
    .not("spotify_playlist_id", "is", null)
    .order("playlist_key", { ascending: true })
    .limit(limit);

  if (cursor) q = q.gt("playlist_key", cursor);
  if (!force) q = q.is("spotify_playlist_image_url", null);

  const { data: rows, error } = await q;
  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const items = (rows ?? []) as Array<{
    playlist_key: string;
    spotify_playlist_id: string | null;
    spotify_playlist_image_url: string | null;
  }>;

  const failures: Array<{ playlist_key: string; error: string }> = [];
  let processed = 0;

  for (const p of items) {
    const id = p.spotify_playlist_id;
    if (!id) continue;
    try {
      const meta = await getPlaylist(id);
      const { error: upErr } = await svc
        .from("playlists")
        .update({
          spotify_playlist_name: meta.name,
          spotify_playlist_image_url: meta.imageUrl,
          spotify_last_fetched_at: new Date().toISOString(),
        })
        .eq("playlist_key", p.playlist_key);
      if (upErr) throw new Error(upErr.message);
      processed += 1;
    } catch (e) {
      failures.push({
        playlist_key: p.playlist_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const nextCursor = items.length ? items[items.length - 1]!.playlist_key : null;
  const done = items.length < limit;

  return apiJsonOk({
    processed,
    cursor: nextCursor,
    done,
    failures,
  });
}
