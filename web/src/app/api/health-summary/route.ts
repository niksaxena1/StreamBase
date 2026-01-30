import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

// This route is time-sensitive (used for polling).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sb = await supabaseServer();

    const { data: latestRun } = await sb
      .from("ingestion_runs")
      .select("run_date,status")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun?.run_date) {
      return NextResponse.json(
        { latestRun: null, criticalWarnings: 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const runDate = latestRun.run_date as string;
    const status = (latestRun.status as string | null) ?? "unknown";

    const { count: criticalWarnings } = await sb
      .from("ingestion_warnings")
      .select("id", { count: "exact", head: true })
      .eq("run_date", runDate)
      .eq("severity", "critical");

    return NextResponse.json(
      {
        latestRun: { runDate, status },
        criticalWarnings: criticalWarnings ?? 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[health-summary] error:", e);
    return NextResponse.json(
      { latestRun: null, criticalWarnings: 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}

