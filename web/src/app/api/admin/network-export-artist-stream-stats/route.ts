import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const MAX_ARTISTS = 12000;
const CHUNK = 800;

type RpcRow = {
  artist_id: string;
  total_streams_in_scope: number;
  daily_streams_in_scope: number;
  tracks_all_catalog: number;
  total_streams_all_catalog: number;
  daily_streams_all_catalog: number;
};

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
    return NextResponse.json({ rows: [] as RpcRow[] });
  }

  const svc = supabaseService();
  const merged: RpcRow[] = [];

  for (const part of chunk(artistIds, CHUNK)) {
    const { data, error } = await svc.rpc("network_export_artist_stream_stats", {
      p_artist_ids: part,
      p_playlist_key: playlistKey,
      p_hide_non_primary: hideNonPrimary,
    });

    if (error) {
      console.error("network_export_artist_stream_stats:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{
      artist_id: string;
      total_streams_in_scope: number | string | null;
      daily_streams_in_scope: number | string | null;
      tracks_all_catalog: number | string | null;
      total_streams_all_catalog: number | string | null;
      daily_streams_all_catalog: number | string | null;
    }>;

    for (const r of rows) {
      merged.push({
        artist_id: r.artist_id,
        total_streams_in_scope: Number(r.total_streams_in_scope ?? 0) || 0,
        daily_streams_in_scope: Number(r.daily_streams_in_scope ?? 0) || 0,
        tracks_all_catalog: Number(r.tracks_all_catalog ?? 0) || 0,
        total_streams_all_catalog: Number(r.total_streams_all_catalog ?? 0) || 0,
        daily_streams_all_catalog: Number(r.daily_streams_all_catalog ?? 0) || 0,
      });
    }
  }

  return NextResponse.json({ rows: merged });
}
