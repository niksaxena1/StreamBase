import { NextRequest } from "next/server";

import type { PlaylistRow } from "@/app/(main-flat)/competitors/competitorsTypes";
import { loadCompetitorsIntel } from "@/lib/competitors/loadCompetitorsIntel";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { getRollbackDate } from "@/lib/rollback";
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
  const latestDataDate = String(req.nextUrl.searchParams.get("data_date") ?? "").trim();
  const weekAgoDataDate = String(req.nextUrl.searchParams.get("week_ago_data_date") ?? "").trim() || null;
  const churnRaw = Number(req.nextUrl.searchParams.get("churn_window") ?? 7);
  const churnWindow: 7 | 30 = churnRaw === 30 ? 30 : 7;
  const scopeRaw = String(req.nextUrl.searchParams.get("scope") ?? "full").trim();
  const scope: "full" | "churn" = scopeRaw === "churn" ? "churn" : "full";

  if (!isIsoDate(runDate)) return apiJsonErr("invalid run_date", 400);
  if (!isIsoDate(latestDataDate)) return apiJsonErr("invalid data_date", 400);
  if (weekAgoDataDate && !isIsoDate(weekAgoDataDate)) {
    return apiJsonErr("invalid week_ago_data_date", 400);
  }

  const svc = supabaseService();
  const comp = svc.schema("competitor");
  const rollbackDate = await getRollbackDate();
  const rollbackSuffix = rollbackDate ?? "live";

  const { data: playlistsRaw, error: playlistsErr } = await comp
    .from("playlists")
    .select("playlist_key,label_key,display_name,spotify_playlist_image_url,sot_dashboard_url,display_order,is_active");

  if (playlistsErr) return apiJsonErr(playlistsErr.message, 500);

  const playlists = (playlistsRaw ?? []) as PlaylistRow[];
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const playlistsByLabel = new Map<string, PlaylistRow[]>();
  for (const playlist of playlists) {
    const rows = playlistsByLabel.get(playlist.label_key) ?? [];
    rows.push(playlist);
    playlistsByLabel.set(playlist.label_key, rows);
  }

  const intel = await loadCompetitorsIntel({
    svc,
    latestRunDate: runDate,
    latestDataDate,
    weekAgoDataDate,
    playlistKeys,
    playlistsByLabel,
    churnWindow,
    rollbackSuffix,
    scope,
  });

  if (scope === "churn") {
    return apiJsonOk({ churn: intel.churn });
  }

  return apiJsonOk(intel);
}
