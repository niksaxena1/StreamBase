import { NextRequest } from "next/server";

import { isPlaylistWatchOnlyAccess, normalizeAppAccess } from "@/lib/appAccess";
import { apiJsonErr, apiJsonOk, requireSessionUser } from "@/lib/api/server";
import { loadHomeScatterDataForUser } from "@/lib/home/loadHomeDashboard";
import { normalizeHomeScatterApiPayload } from "@/lib/home/homeScatterApi";
import { logError } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sb = await supabaseServer();
    const auth = await requireSessionUser(sb);
    if (!auth.ok) return auth.response;

    const svc = supabaseService();
    const [{ data: isAdmin }, { data: accessRow }] = await Promise.all([
      sb.rpc("is_admin"),
      svc
        .from("app_user_access")
        .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")
        .eq("user_id", auth.user.id)
        .maybeSingle(),
    ]);
    const appAccess = normalizeAppAccess(accessRow, Boolean(isAdmin));
    if (isPlaylistWatchOnlyAccess(appAccess) || (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor)) {
      return apiJsonErr("forbidden", 403);
    }

    const sp = request.nextUrl.searchParams;
    const payload = await loadHomeScatterDataForUser({
      svc,
      userId: auth.user.id,
      sp: {
        scope: sp.get("scope") ?? undefined,
        range: sp.get("range") ?? undefined,
        daily: sp.get("daily") ?? undefined,
        xy_date: sp.get("xy_date") ?? undefined,
        start: sp.get("start") ?? undefined,
        end: sp.get("end") ?? undefined,
      },
    });

    return apiJsonOk(normalizeHomeScatterApiPayload(payload));
  } catch (error) {
    logError("[home-scatter] error", error);
    const message = error instanceof Error ? error.message : String(error);
    return apiJsonOk({
      points: [],
      errorMessage: message || "Failed to load Home scatter data",
      dataDate: null,
    });
  }
}
