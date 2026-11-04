import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const UPLOAD_SLUG = "upload";
const TRACK_ID_RE = /^[A-Za-z0-9]{16,32}$/;
const PAGE = 1000;

function dateOnly(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await ctx.params;
  if (!TRACK_ID_RE.test(trackId)) return apiJsonErr("invalid_track_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const pw = supabaseService().schema("playlist_watch");

  const playlistRes = await pw.from("track_watch_playlists").select("spotify_playlist_id").eq("slug", UPLOAD_SLUG).maybeSingle();
  if (playlistRes.error) return apiJsonErr(playlistRes.error.message, 500);
  const playlistId = (playlistRes.data as { spotify_playlist_id: string } | null)?.spotify_playlist_id ?? null;

  const membershipRes = playlistId
    ? await pw
        .from("track_watch_memberships")
        .select("added_at,first_seen_date,removed_date")
        .eq("spotify_playlist_id", playlistId)
        .eq("spotify_track_id", trackId)
        .order("first_seen_date", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (membershipRes.error) return apiJsonErr(membershipRes.error.message, 500);

  // Page through snapshots so a long history is never truncated by the API row cap.
  const snapshots: { date: string; playcount: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await pw
      .from("track_watch_stream_snapshots")
      .select("date,playcount")
      .eq("spotify_track_id", trackId)
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) return apiJsonErr(res.error.message, 500);
    const batch = (res.data ?? []) as { date: string; playcount: number | string | null }[];
    for (const r of batch) {
      const date = dateOnly(r.date);
      const playcount = Number(r.playcount);
      if (date && r.playcount !== null && Number.isFinite(playcount)) snapshots.push({ date, playcount });
    }
    if (batch.length < PAGE) break;
  }

  const m = membershipRes.data as { added_at: string | null; first_seen_date: string | null; removed_date: string | null } | null;
  return apiJsonOk(
    {
      track_id: trackId,
      snapshots,
      membership: m
        ? { added_at: m.added_at, first_seen_date: dateOnly(m.first_seen_date), removed_date: dateOnly(m.removed_date) }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
