import { revalidateTag } from "next/cache";
import { NextRequest, after } from "next/server";

import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { timingSafeEqualStrings } from "@/lib/api/internalAuth";
import { SUPABASE_CACHE_TAG } from "@/lib/supabase/cache";
import { recomputeActiveWarningSnapshot } from "@/lib/health/activeWarnings";
import { loadWorkspaceInsightsCached } from "@/lib/competitors/workspaceInsights";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cache warming runs after the response; give it room beyond the pipeline's timeout.
export const maxDuration = 300;

/**
 * Rebuild the competitor workspace caches (Movement + Catalog intelligence).
 * These fan out across every label and take several seconds cold, so warming
 * them here means the first visit after ingestion is served from cache.
 */
async function warmCompetitorWorkspaceInsights(): Promise<void> {
  const svc = supabaseService();
  // Must match how the Competitors page picks latestRunDate (successful runs
  // only), or the warmed cache key will not be the one the client requests.
  const { data: latestRun } = await svc
    .schema("competitor")
    .from("ingestion_runs")
    .select("run_date")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const runDate = String((latestRun as { run_date?: string } | null)?.run_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return;

  const results = await Promise.allSettled([
    loadWorkspaceInsightsCached({ scope: "movement", runDate }),
    loadWorkspaceInsightsCached({ scope: "catalog", runDate }),
  ]);
  for (const [index, result] of results.entries()) {
    const scope = index === 0 ? "movement" : "catalog";
    if (result.status === "rejected") {
      console.error(`Workspace insights warm failed (${scope}):`, result.reason);
    } else if (result.value.error) {
      console.error(`Workspace insights warm failed (${scope}):`, result.value.error.message);
    }
  }
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET ?? "";
  if (!secret) {
    // A missing secret means ingestion cannot refresh caches; surface it.
    console.error("REVALIDATE_SECRET is not set; refusing revalidation request. Cached analytics will only refresh via TTL expiry.");
    return false;
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return timingSafeEqualStrings(auth.slice(7).trim(), secret.trim());
}

/**
 * Called by the ingestion pipeline after a successful run. With no body (or an
 * empty tag list) it revalidates the generic tag carried by every cachedQuery
 * entry — safe because analytics data only changes at ingestion time.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return apiJsonErr("unauthorized", 401);

  const body = await readJsonBodyOptional(request);
  const requested = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim())
    : [];
  // "health" covers getActiveWarningSummary (raw unstable_cache, not
  // cachedQuery, so the generic supabase tag does not reach it).
  const tags = requested.length ? requested : [SUPABASE_CACHE_TAG, "health"];

  // Refresh the stored health snapshot BEFORE busting caches so the first
  // post-ingestion render reads the fresh precomputed row (instead of paying
  // the expensive warning pipeline inline).
  let healthSnapshotRefreshed = false;
  if (tags.includes("health")) {
    try {
      await recomputeActiveWarningSnapshot();
      healthSnapshotRefreshed = true;
    } catch (e) {
      console.error("Health snapshot recompute failed during revalidation:", e);
    }
  }

  for (const tag of tags) revalidateTag(tag, "max");

  // Warm after the response: the tags above are already invalidated, and the
  // ingestion caller uses a short timeout it should not wait out.
  const warmWorkspace = tags.includes(SUPABASE_CACHE_TAG);
  if (warmWorkspace) {
    after(async () => {
      try {
        await warmCompetitorWorkspaceInsights();
      } catch (e) {
        console.error("Workspace insights warm failed:", e);
      }
    });
  }

  return apiJsonOk({
    revalidated: tags,
    healthSnapshotRefreshed,
    workspaceWarmScheduled: warmWorkspace,
    at: new Date().toISOString(),
  });
}
