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
  const competitorLabelKey = String(req.nextUrl.searchParams.get("competitor_label_key") ?? "").trim();

  if (!isIsoDate(runDate)) return apiJsonErr("invalid run_date", 400);
  if (!competitorLabelKey) return apiJsonErr("missing competitor_label_key", 400);

  const svc = supabaseService();
  const { data, error } = await svc.schema("competitor").rpc("own_catalog_overlap_tracks", {
    p_as_of: runDate,
    p_competitor_label_key: competitorLabelKey,
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
