import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/dates
 * Returns { rows: Array<{ isrc, first_seen, last_seen }> } for all tracks.
 */
export async function GET() {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = supabaseService();

  const pageSize = 1000;
  const hardCap = 100_000;
  const out: Array<{ isrc: string; first_seen: string | null; last_seen: string | null }> = [];

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,first_seen,last_seen")
      .range(offset, offset + pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      out.push({
        isrc: String(r.isrc ?? ""),
        first_seen: (r.first_seen ?? null) as string | null,
        last_seen: (r.last_seen ?? null) as string | null,
      });
    }

    if (rows.length < pageSize) break;
  }

  return NextResponse.json({ rows: out });
}
