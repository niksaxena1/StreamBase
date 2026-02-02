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
  const { data, error } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const playlists = (data ?? []).map((p: any) => ({
    playlist_key: String(p.playlist_key ?? ""),
    display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
    spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
  }));

  return NextResponse.json({ playlists }, { status: 200 });
}

