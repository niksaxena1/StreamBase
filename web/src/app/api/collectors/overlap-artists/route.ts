import { NextRequest } from "next/server";

import type { CollectorOverlapArtistRow } from "@/app/(main-flat)/collectors/collectorsTypes";
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
  const collectorA = String(req.nextUrl.searchParams.get("collector_a") ?? "").trim().toUpperCase();
  const collectorB = String(req.nextUrl.searchParams.get("collector_b") ?? "").trim().toUpperCase();
  const useEntity =
    String(req.nextUrl.searchParams.get("use_entity_playlists") ?? "").trim() === "1";

  if (!isIsoDate(runDate)) return apiJsonErr("invalid run_date", 400);
  if (!collectorA || !collectorB) return apiJsonErr("missing collector_a or collector_b", 400);
  if (collectorA === collectorB) return apiJsonErr("collector_a and collector_b must differ", 400);

  const svc = supabaseService();
  const { data, error } = await svc.rpc("collector_overlap_artists", {
    p_as_of: runDate,
    p_collector_a: collectorA,
    p_collector_b: collectorB,
    p_use_entity_playlists: useEntity,
  });

  if (error) return apiJsonErr(error.message, 500);

  const artists: CollectorOverlapArtistRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
    artist_id: String(row.artist_id ?? "").trim(),
    artist_name: String(row.artist_name ?? row.artist_id ?? "").trim(),
    image_url: typeof row.image_url === "string" ? row.image_url : null,
  }));

  return apiJsonOk({ artists });
}
