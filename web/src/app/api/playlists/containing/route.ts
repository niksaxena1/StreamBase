import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/**
 * Reverse membership lookup: given ISRCs, return the playlist_keys that
 * contain any of them at the given date.
 *
 * POST { date: "YYYY-MM-DD", isrcs: string[] }
 * Returns { playlist_keys: string[] }
 */
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
  const isrcsRaw = (body as any)?.isrcs;

  if (!isIsoDate(date)) {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }

  const isrcs = Array.isArray(isrcsRaw)
    ? isrcsRaw.map((x: any) => String(x ?? "").trim().toUpperCase()).filter(Boolean)
    : [];

  if (isrcs.length === 0) {
    return NextResponse.json({ playlist_keys: [] }, { status: 200 });
  }
  if (isrcs.length > 500) {
    return NextResponse.json({ error: "too many ISRCs (max 500)" }, { status: 400 });
  }

  const svc = supabaseService();

  const pageSize = 1000;
  const hardCap = 200_000;
  const keys = new Set<string>();

  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("playlist_memberships")
      .select("playlist_key")
      .in("isrc", isrcs)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      const pk = String(r?.playlist_key ?? "").trim();
      if (pk) keys.add(pk);
    }

    if (rows.length < pageSize) break;
  }

  return NextResponse.json({ playlist_keys: Array.from(keys) }, { status: 200 });
}
