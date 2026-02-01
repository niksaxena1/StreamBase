import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";

// This route is time-sensitive (used for polling).
export const dynamic = "force-dynamic";

type HealthSummaryPayload = {
  latestRun: { runDate: string; status: string } | null;
  criticalWarnings: number;
};

function safeUrlHost(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const debugRequested = sp.get("debug") === "1";
    const debugToken = process.env.SB_HEALTH_DEBUG_TOKEN ?? "";
    const debugAllowed = debugRequested && !!debugToken && sp.get("token") === debugToken;

    // Even though the client polls, we can safely cache for a short window to
    // reduce DB load without impacting perceived freshness.
    const { data } = await cachedQuery<HealthSummaryPayload>(
      async () => {
        const sb = await supabaseServer();
        let db: typeof sb;
        let usedService = false;
        try {
          db = supabaseService() as unknown as typeof sb;
          usedService = true;
        } catch {
          db = sb;
        }

        const { data: latestRun, error: latestRunError } = await db
          .from("ingestion_runs")
          .select("run_date,status")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestRun?.run_date) {
          if (debugAllowed) {
            const { data: sessionData } = await sb.auth.getSession();
            return {
              data: {
                latestRun: null,
                criticalWarnings: 0,
                debug: {
                  usedService,
                  supabaseUrlHost: safeUrlHost(process.env.NEXT_PUBLIC_SUPABASE_URL),
                  hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                  sessionUserId: sessionData.session?.user?.id ?? null,
                  latestRunError: (latestRunError as any)?.message ?? null,
                },
              },
              error: null,
            };
          }
          return { data: { latestRun: null, criticalWarnings: 0 }, error: null };
        }

        const runDate = latestRun.run_date as string;
        const status = (latestRun.status as string | null) ?? "unknown";

        const { count: criticalWarnings, error: criticalWarningsError } = await db
          .from("ingestion_warnings")
          .select("id", { count: "exact", head: true })
          .eq("run_date", runDate)
          .eq("severity", "critical");

        if (debugAllowed) {
          const { data: sessionData } = await sb.auth.getSession();
          return {
            data: {
              latestRun: { runDate, status },
              criticalWarnings: criticalWarnings ?? 0,
              debug: {
                usedService,
                supabaseUrlHost: safeUrlHost(process.env.NEXT_PUBLIC_SUPABASE_URL),
                hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                sessionUserId: sessionData.session?.user?.id ?? null,
                latestRunError: (latestRunError as any)?.message ?? null,
                criticalWarningsError: (criticalWarningsError as any)?.message ?? null,
              },
            },
            error: null,
          };
        }

        return {
          data: {
            latestRun: { runDate, status },
            criticalWarnings: criticalWarnings ?? 0,
          },
          error: null,
        };
      },
      "health-summary",
      20, // 20s short cache for polling route
    );

    return NextResponse.json((data ?? { latestRun: null, criticalWarnings: 0 }) satisfies HealthSummaryPayload, {
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

