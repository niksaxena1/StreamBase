import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARTISTS = 12000;

export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const b = body as {
    artistIds?: unknown;
    playlistKey?: unknown;
    hideNonPrimary?: unknown;
  };

  const rawIds = Array.isArray(b.artistIds)
    ? b.artistIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
    : [];
  const artistIds = [...new Set(rawIds)].slice(0, MAX_ARTISTS);

  const playlistKey =
    typeof b.playlistKey === "string" && b.playlistKey.trim() ? b.playlistKey.trim() : null;
  const hideNonPrimary = Boolean(b.hideNonPrimary);

  if (!artistIds.length) {
    return NextResponse.json({
      trackCount: 0,
      totalStreams: 0,
      dailyStreams: 0,
    });
  }

  const svc = supabaseService();
  const { data, error } = await svc.rpc("network_selection_scoped_track_totals", {
    p_artist_ids: artistIds,
    p_playlist_key: playlistKey,
    p_hide_non_primary: hideNonPrimary,
  });

  if (error) {
    console.error("network_selection_scoped_track_totals:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const r = row as {
    track_count?: number | string | null;
    total_streams?: number | string | null;
    daily_streams?: number | string | null;
  } | null;

  return NextResponse.json({
    trackCount: Number(r?.track_count ?? 0) || 0,
    totalStreams: Number(r?.total_streams ?? 0) || 0,
    dailyStreams: Number(r?.daily_streams ?? 0) || 0,
  });
}
