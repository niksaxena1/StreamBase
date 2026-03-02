import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = supabaseService();

  const [playlistsRes, statsRes] = await Promise.all([
    svc
      .from("playlists")
      .select(
        "playlist_key,display_name,is_catalog,playlist_type,collector,spotify_playlist_image_url",
      )
      .order("display_name", { ascending: true }),
    svc
      .from("playlist_daily_stats")
      .select("playlist_key,date,track_count,total_streams_cumulative,daily_streams_net")
      .order("date", { ascending: false }),
  ]);

  if (playlistsRes.error) {
    return NextResponse.json({ error: playlistsRes.error.message }, { status: 500 });
  }
  if (statsRes.error) {
    return NextResponse.json({ error: statsRes.error.message }, { status: 500 });
  }

  // Keep only the latest stats row per playlist_key
  const latestStats = new Map<
    string,
    { track_count: number; total_streams: number; daily_streams: number | null }
  >();
  for (const s of statsRes.data ?? []) {
    const pk = String((s as any).playlist_key ?? "");
    if (!pk || latestStats.has(pk)) continue;
    latestStats.set(pk, {
      track_count: Number((s as any).track_count ?? 0),
      total_streams: Number((s as any).total_streams_cumulative ?? 0),
      daily_streams:
        (s as any).daily_streams_net != null
          ? Number((s as any).daily_streams_net)
          : null,
    });
  }

  const playlists = (playlistsRes.data ?? []).map((p: any) => {
    const pk = String(p.playlist_key ?? "");
    const stats = latestStats.get(pk);
    return {
      playlist_key: pk,
      display_name: String(p.display_name ?? pk).trim(),
      is_catalog: Boolean(p.is_catalog),
      playlist_type: (p.playlist_type ?? null) as string | null,
      collector: (p.collector ?? null) as string | null,
      spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
      track_count: stats?.track_count ?? 0,
      total_streams: stats?.total_streams ?? 0,
      daily_streams: stats?.daily_streams ?? null,
    };
  });

  return NextResponse.json({ playlists }, { status: 200 });
}
