import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const date = (body as any)?.date;
  const playlistKeysRaw = (body as any)?.playlist_keys;
  const playlist_keys = Array.isArray(playlistKeysRaw)
    ? playlistKeysRaw.map((x: any) => String(x ?? "").trim()).filter(Boolean)
    : [];

  if (!isIsoDate(date)) {
    return NextResponse.json({ error: "invalid run_date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  if (playlist_keys.length === 0) {
    return NextResponse.json({ rows: [] }, { status: 200 });
  }
  if (playlist_keys.length > 25) {
    return NextResponse.json({ error: "too many playlist keys (max 25)" }, { status: 400 });
  }

  const svc = supabaseService();

  // PostgREST caps responses; page explicitly.
  const pageSize = 1000;
  const hardCap = 200_000;
  const out: Array<{ playlist_key: string; isrc: string }> = [];

  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("playlist_memberships")
      .select("playlist_key,isrc,valid_from,valid_to")
      .in("playlist_key", playlist_keys)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .order("playlist_key", { ascending: true })
      .order("isrc", { ascending: true })
      .range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      const pk = String(r?.playlist_key ?? "").trim();
      const isrc = String(r?.isrc ?? "").trim().toUpperCase();
      if (!pk || !isrc) continue;
      out.push({ playlist_key: pk, isrc });
    }

    if (rows.length < pageSize) break;
  }

  return NextResponse.json({ rows: out }, { status: 200 });
}

