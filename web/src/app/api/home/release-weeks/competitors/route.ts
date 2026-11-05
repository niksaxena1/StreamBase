import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { CACHE_TTL_24H } from "@/lib/constants";
import { loadCompetitorLabelsWithImages } from "@/lib/competitorContext.server";
import { logError } from "@/lib/logger";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { cachedQuery } from "@/lib/supabase/cache";
import { canCompareCompetitorReleaseWeeks, type CompetitorReleaseSummaryRow } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Competitor side of Home "Change by release week": per competitor + release date totals for the
 * same 7-day windows as the own-catalog section. Read-only, competitor schema only, admin/competitor
 * access only. Cached per run date (the competitor read is ~4-6 s; data changes once a day).
 */
export async function GET(request: NextRequest) {
  try {
    const { svc, user, isAdmin, appAccess } = await getRequestAppContext();
    if (!user) return apiJsonErr("unauthenticated", 401);
    if (!canCompareCompetitorReleaseWeeks(isAdmin, appAccess)) return apiJsonErr("forbidden", 403);
    const runDate = request.nextUrl.searchParams.get("run_date");
    if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return apiJsonErr("invalid_run_date", 400);

    // The generated database types predate this RPC.
    const comp = (svc as SupabaseClient).schema("competitor");
    const [labels, summary] = await Promise.all([
      loadCompetitorLabelsWithImages(),
      cachedQuery<CompetitorReleaseSummaryRow[]>(
        async () => {
          const rows: CompetitorReleaseSummaryRow[] = [];
          const size = 1000;
          for (let offset = 0; ; offset += size) {
            const { data, error } = await comp
              .rpc("release_week_summary", { p_run_date: runDate })
              .order("label_key")
              .order("release_date")
              .range(offset, offset + size - 1);
            if (error) return { data: null, error };
            const page = (data ?? []) as CompetitorReleaseSummaryRow[];
            rows.push(...page);
            if (page.length < size) break;
          }
          return { data: rows, error: null };
        },
        `home-release-weeks-competitors|date:${runDate}`,
        CACHE_TTL_24H,
      ),
    ]);
    if (summary.error) throw summary.error;
    return apiJsonOk({ runDate, labels, rows: summary.data ?? [] });
  } catch (error) {
    logError("[home-release-weeks-competitors] error", error);
    return apiJsonErr("Failed to load competitor release weeks", 500);
  }
}
