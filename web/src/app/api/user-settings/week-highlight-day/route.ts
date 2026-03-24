import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAY = 0;

function parseDayIndex(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) throw new Error("Day must be a number (0-6).");
  const i = Math.trunc(n);
  if (i < 0 || i > 6) throw new Error("Day must be between 0 and 6.");
  return i;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_week_highlight_day")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ chart_week_highlight_day: DEFAULT_DAY, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const day = Number((settings as { chart_week_highlight_day?: unknown } | null)?.chart_week_highlight_day ?? DEFAULT_DAY);
  const normalized = Number.isFinite(day) && day >= 0 && day <= 6 ? Math.trunc(day) : DEFAULT_DAY;
  return apiJsonOk({ chart_week_highlight_day: normalized, configured: true as const });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let day: number;
  try {
    day = parseDayIndex(body.chart_week_highlight_day ?? body.day ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid day.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, chart_week_highlight_day: day }], { onConflict: "user_id" })
    .select("chart_week_highlight_day")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Week highlight day setting isn’t configured in the database yet. Add the `chart_week_highlight_day` column to `user_settings`, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const saved = Number((upserted as { chart_week_highlight_day?: unknown } | null)?.chart_week_highlight_day ?? day);
  const normalized = Number.isFinite(saved) && saved >= 0 && saved <= 6 ? Math.trunc(saved) : day;
  return apiJsonOk({ chart_week_highlight_day: normalized, configured: true as const });
}
