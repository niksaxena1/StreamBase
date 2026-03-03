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

  // Fetch playlists first so we have the exact set of keys to query.
  const playlistsRes = await svc
    .from("playlists")
    .select(
      "playlist_key,display_name,is_catalog,playlist_type,collector,spotify_playlist_image_url",
    )
    .order("display_name", { ascending: true })
    .limit(2000);

  if (playlistsRes.error) {
    return NextResponse.json({ error: playlistsRes.error.message }, { status: 500 });
  }

  const playlistKeys = (playlistsRes.data ?? []).map((p: any) => String(p.playlist_key ?? "")).filter(Boolean);

  // Find the single latest run date across all playlists — one fast query.
  const { data: latestDateRow } = await svc
    .from("playlist_daily_stats")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestDate = (latestDateRow as { date: string } | null)?.date ?? null;

  // Fetch stats for only the latest date and only the known playlist keys.
  // This replaces an unbounded all-time table scan with a precise point-in-time read.
  const latestStats = new Map<
    string,
    { track_count: number; total_streams: number; daily_streams: number | null }
  >();

  if (latestDate && playlistKeys.length > 0) {
    const { data: statsRows, error: statsErr } = await svc
      .from("playlist_daily_stats")
      .select("playlist_key,track_count,total_streams_cumulative,daily_streams_net")
      .eq("date", latestDate)
      .in("playlist_key", playlistKeys);

    if (statsErr) {
      return NextResponse.json({ error: statsErr.message }, { status: 500 });
    }

    for (const s of statsRows ?? []) {
      const pk = String((s as any).playlist_key ?? "");
      if (!pk) continue;
      latestStats.set(pk, {
        track_count: Number((s as any).track_count ?? 0),
        total_streams: Number((s as any).total_streams_cumulative ?? 0),
        daily_streams:
          (s as any).daily_streams_net != null ? Number((s as any).daily_streams_net) : null,
      });
    }
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
