import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const date = body.date;
  const playlistKeysRaw = body.playlist_keys;
  const playlist_keys = Array.isArray(playlistKeysRaw)
    ? playlistKeysRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  if (!isIsoDate(date)) {
    return apiJsonErr("invalid run_date (expected YYYY-MM-DD)", 400);
  }
  if (playlist_keys.length === 0) {
    return apiJsonOk({ rows: [] as Array<{ playlist_key: string; isrc: string }> });
  }
  if (playlist_keys.length > 25) {
    return apiJsonErr("too many playlist keys (max 25)", 400);
  }

  const svc = supabaseService();

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

    if (error) return apiJsonErr(error.message, 500);
    const rows = (data ?? []) as Array<{ playlist_key?: unknown; isrc?: unknown }>;
    if (!rows.length) break;

    for (const r of rows) {
      const pk = String(r?.playlist_key ?? "").trim();
      const isrc = String(r?.isrc ?? "").trim().toUpperCase();
      if (!pk || !isrc) continue;
      out.push({ playlist_key: pk, isrc });
    }

    if (rows.length < pageSize) break;
  }

  return apiJsonOk({ rows: out });
}
