import { NextRequest } from "next/server";

import { getActiveWarningSummary } from "@/lib/health/activeWarnings";
import { logError } from "@/lib/logger";
import { apiJsonOk } from "@/lib/api/server";

export const dynamic = "force-dynamic";

type HealthSummaryPayload = {
  latestRun: { runDate: string; status: string } | null;
  criticalWarnings: number;
};

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const debugRequested = sp.get("debug") === "1";
    const debugToken = process.env.SB_HEALTH_DEBUG_TOKEN ?? "";
    const debugAllowed = debugRequested && !!debugToken && sp.get("token") === debugToken;

    const summary = await getActiveWarningSummary();

    const payload: HealthSummaryPayload & { debug?: Record<string, unknown> } = {
      latestRun: summary.runDate ? { runDate: summary.runDate, status: "success" } : null,
      criticalWarnings: summary.criticalCount,
    };

    if (debugAllowed) {
      payload.debug = {
        totalActive: summary.totalCount,
        hasCritical: summary.hasCritical,
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
