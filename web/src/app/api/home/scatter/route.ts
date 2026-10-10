import { NextRequest } from "next/server";

import { isPlaylistWatchOnlyAccess } from "@/lib/appAccess";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { loadHomeScatterDataForUser } from "@/lib/home/loadHomeDashboard";
import { normalizeHomeScatterApiPayload } from "@/lib/home/homeScatterApi";
import { logError } from "@/lib/logger";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestAppContext();
    const { svc, user, isAdmin, appAccess } = context;
    if (!user) return apiJsonErr("unauthenticated", 401);
    if (isPlaylistWatchOnlyAccess(appAccess) || (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor)) {
      return apiJsonErr("forbidden", 403);
    }

    const sp = request.nextUrl.searchParams;
    const payload = await loadHomeScatterDataForUser({
      svc,
      userId: user.id,
      context,
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
