import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { DEFAULT_CHART_START_DATE_ISO, normalizeIsoDateOrNull } from "@/components/charts/chartUtils";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIsoDateOrNull(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const norm = normalizeIsoDateOrNull(s);
  if (!norm) throw new Error("Date must be in YYYY-MM-DD format.");
  return norm;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_start_date")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ chart_start_date: DEFAULT_CHART_START_DATE_ISO, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const raw = (settings as { chart_start_date?: unknown } | null)?.chart_start_date ?? null;
  const normalized = normalizeIsoDateOrNull(raw) ?? DEFAULT_CHART_START_DATE_ISO;
  return apiJsonOk({ chart_start_date: normalized, configured: true as const });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let chartStartDate: string | null;
  try {
    chartStartDate = parseIsoDateOrNull(body.chart_start_date ?? body.chartStartDate ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid date.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, chart_start_date: chartStartDate }], { onConflict: "user_id" })
    .select("chart_start_date")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Chart start date setting isn’t configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const savedRaw = (upserted as { chart_start_date?: unknown } | null)?.chart_start_date ?? chartStartDate;
  const normalized = normalizeIsoDateOrNull(savedRaw) ?? DEFAULT_CHART_START_DATE_ISO;
  return apiJsonOk({ chart_start_date: normalized, configured: true as const });
}
