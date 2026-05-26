import { NextRequest } from "next/server";

import { logError } from "@/lib/logger";
import { apiJsonOk, requireSessionUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";
import { loadIngestionSummaryForUser } from "@/lib/ingestionSummary.server";

export const dynamic = "force-dynamic";

type HealthSummaryPayload = {
  latestRun: { runDate: string; status: string } | null;
  criticalWarnings: number;
};

export async function GET(request: NextRequest) {
  try {
    const sb = await supabaseServer();
    const auth = await requireSessionUser(sb);
    if (!auth.ok) return auth.response;

    const sp = request.nextUrl.searchParams;
    const debugRequested = sp.get("debug") === "1";
    const debugToken = process.env.SB_HEALTH_DEBUG_TOKEN ?? "";
    const headerToken = request.headers.get("x-sb-health-debug-token") ?? "";
    const debugAllowed = debugRequested && !!debugToken && headerToken === debugToken;

    const summary = await loadIngestionSummaryForUser(auth.user.id);

    const payload: HealthSummaryPayload & { debug?: Record<string, unknown> } = {
      latestRun: summary.latestRun,
      criticalWarnings: summary.criticalWarnings,
    };

    if (debugAllowed) {
      payload.debug = {
        runDate: summary.latestRun?.runDate ?? null,
        status: summary.latestRun?.status ?? null,
      };
    }

    return apiJsonOk(payload satisfies HealthSummaryPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    logError("[health-summary] error", e);
    return apiJsonOk(
      { latestRun: null, criticalWarnings: 0 } satisfies HealthSummaryPayload,
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
