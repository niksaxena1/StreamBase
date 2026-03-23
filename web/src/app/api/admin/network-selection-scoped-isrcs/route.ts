import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARTISTS = 12000;
const PAGE_LIMIT = 8000;

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
    offset?: unknown;
  };

  const rawIds = Array.isArray(b.artistIds)
    ? b.artistIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
    : [];
  const artistIds = [...new Set(rawIds)].slice(0, MAX_ARTISTS);

  const playlistKey =
    typeof b.playlistKey === "string" && b.playlistKey.trim() ? b.playlistKey.trim() : null;
  const hideNonPrimary = Boolean(b.hideNonPrimary);
  const offsetRaw = typeof b.offset === "number" && Number.isFinite(b.offset) ? Math.floor(b.offset) : 0;
  const offset = Math.max(0, offsetRaw);

  if (!artistIds.length) {
    return NextResponse.json({ isrcs: [] as string[], hasMore: false });
  }

  const svc = supabaseService();
  const { data, error } = await svc.rpc("network_selection_scoped_isrcs", {
    p_artist_ids: artistIds,
    p_playlist_key: playlistKey,
    p_hide_non_primary: hideNonPrimary,
    p_limit: PAGE_LIMIT + 1,
    p_offset: offset,
  });

  if (error) {
    console.error("network_selection_scoped_isrcs:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{ isrc: string } | string>;
  const flat = rows.map((r) => (typeof r === "string" ? r : r.isrc)).filter(Boolean);
  const hasMore = flat.length > PAGE_LIMIT;
  const isrcs = hasMore ? flat.slice(0, PAGE_LIMIT) : flat;

  return NextResponse.json({ isrcs, hasMore, nextOffset: hasMore ? offset + PAGE_LIMIT : null });
}
