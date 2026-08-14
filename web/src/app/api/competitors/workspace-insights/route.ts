import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { isIsoDate, loadWorkspaceInsightsCached } from "@/lib/competitors/workspaceInsights";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const scope = String(req.nextUrl.searchParams.get("scope") ?? "").trim();
  if (scope !== "movement" && scope !== "catalog") return apiJsonErr("invalid scope", 400);
  const runDate = String(req.nextUrl.searchParams.get("run_date") ?? "").trim();
  if (!isIsoDate(runDate)) return apiJsonErr("invalid run_date", 400);

  const result = await loadWorkspaceInsightsCached({ scope, runDate });
  if (result.error) return apiJsonErr(result.error.message, 500);
  return apiJsonOk(result.data);
}
