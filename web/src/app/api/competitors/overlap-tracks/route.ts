import { NextRequest } from "next/server";

import type { OverlapTrackRow } from "@/app/(main-flat)/competitors/competitorsTypes";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const runDate = String(req.nextUrl.searchParams.get("run_date") ?? "").trim();
  const labelA = String(req.nextUrl.searchParams.get("label_a") ?? "").trim();
  const labelB = String(req.nextUrl.searchParams.get("label_b") ?? "").trim();

  if (!isIsoDate(runDate)) return apiJsonErr("invalid run_date", 400);
  if (!labelA || !labelB) return apiJsonErr("missing label_a or label_b", 400);
  if (labelA === labelB) return apiJsonErr("label_a and label_b must differ", 400);

  const svc = supabaseService();
  const { data, error } = await svc.schema("competitor").rpc("label_overlap_tracks", {
    p_as_of: runDate,
    p_label_a: labelA,
    p_label_b: labelB,
  });

  if (error) return apiJsonErr(error.message, 500);

  const tracks: OverlapTrackRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
    isrc: String(row.isrc ?? "").trim(),
    name: String(row.name ?? row.isrc ?? "").trim(),
    album_image_url: typeof row.album_image_url === "string" ? row.album_image_url : null,
    artist_names: Array.isArray(row.artist_names) ? (row.artist_names as string[]) : null,
  }));

  return apiJsonOk({ tracks });
}
