import { NextRequest } from "next/server";

import { isPlaylistWatchOnlyAccess } from "@/lib/appAccess";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { loadHomeDiagnosticsDataForUser } from "@/lib/home/loadHomeDashboard";
import { normalizeHomeDiagnosticsApiPayload } from "@/lib/home/homeDiagnosticsApi";
import { logError } from "@/lib/logger";
import { timedServerStep } from "@/lib/serverTiming";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return await timedServerStep("api.home.diagnostics", async () => {
      const context = await getRequestAppContext();
      const { sb, svc, user, isAdmin, appAccess } = context;
      if (!user) return apiJsonErr("unauthenticated", 401);
      if (isPlaylistWatchOnlyAccess(appAccess) || (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor)) {
        return apiJsonErr("forbidden", 403);
      }

      const sp = request.nextUrl.searchParams;
      const payload = await loadHomeDiagnosticsDataForUser({
        sb,
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

      return apiJsonOk(normalizeHomeDiagnosticsApiPayload(payload));
    });
  } catch (error) {
    logError("[home-diagnostics] error", error);
    const message = error instanceof Error ? error.message : String(error);
    return apiJsonOk({
      artistWeekendDips: [],
      trackWeekendDips: [],
      negativeDailyStreams: [],
      artificialStreamSpikes: [],
      errorMessage: message || "Failed to load Home diagnostics",
    });
  }
}
