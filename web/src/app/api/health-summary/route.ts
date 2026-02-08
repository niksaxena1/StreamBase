import { NextRequest, NextResponse } from "next/server";

import { getActiveWarningSummary } from "@/lib/health/activeWarnings";

// This route is time-sensitive (used for polling).
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

    // Use the shared cached function so counts stay consistent with badge + page.
    const summary = await getActiveWarningSummary();

    const payload: HealthSummaryPayload & { debug?: Record<string, unknown> } = {
      latestRun: summary.runDate
        ? { runDate: summary.runDate, status: "success" }
        : null,
      criticalWarnings: summary.criticalCount,
    };

    if (debugAllowed) {
      payload.debug = {
        totalActive: summary.totalCount,
        hasCritical: summary.hasCritical,
      };
    }

    return NextResponse.json(payload satisfies HealthSummaryPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[health-summary] error:", e);
    return NextResponse.json(
      { latestRun: null, criticalWarnings: 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
