import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { timingSafeEqualStrings } from "@/lib/api/internalAuth";
import { SUPABASE_CACHE_TAG } from "@/lib/supabase/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  for (const tag of tags) revalidateTag(tag, "max");

  return apiJsonOk({ revalidated: tags, at: new Date().toISOString() });
}
