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
  const isrcsRaw = body.isrcs;

  if (!isIsoDate(date)) {
    return apiJsonErr("invalid date (expected YYYY-MM-DD)", 400);
  }

  const isrcs = Array.isArray(isrcsRaw)
    ? isrcsRaw.map((x) => String(x ?? "").trim().toUpperCase()).filter(Boolean)
    : [];

  if (isrcs.length === 0) {
    return apiJsonOk({ playlist_keys: [] as string[] });
  }
  if (isrcs.length > 500) {
    return apiJsonErr("too many ISRCs (max 500)", 400);
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

    if (error) return apiJsonErr(error.message, 500);
    const rows = (data ?? []) as Array<{ playlist_key?: unknown }>;
    if (!rows.length) break;

    for (const r of rows) {
      const pk = String(r?.playlist_key ?? "").trim();
      if (pk) keys.add(pk);
    }

    if (rows.length < pageSize) break;
  }

  return apiJsonOk({ playlist_keys: Array.from(keys) });
}
