import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RevenueDecimalDisplayMode = "normal" | "muted" | "hidden";

function parseRevenueDecimalDisplay(raw: unknown): RevenueDecimalDisplayMode {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "normal" || s === "muted" || s === "hidden") return s;
  throw new Error("Revenue decimal display must be normal, muted, or hidden.");
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("revenue_decimal_display")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ revenue_decimal_display: "normal" as const, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const raw = (settings as { revenue_decimal_display?: unknown } | null)?.revenue_decimal_display ?? "normal";
  let normalized: RevenueDecimalDisplayMode = "normal";
  try {
    normalized = parseRevenueDecimalDisplay(raw);
  } catch {
    normalized = "normal";
  }

  return apiJsonOk({ revenue_decimal_display: normalized, configured: true as const });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let display: RevenueDecimalDisplayMode;
  try {
    display = parseRevenueDecimalDisplay(body.revenue_decimal_display ?? body.revenueDecimalDisplay ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid revenue decimal display.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, revenue_decimal_display: display }], { onConflict: "user_id" })
    .select("revenue_decimal_display")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Revenue decimal setting is not configured in the database yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const savedRaw = (upserted as { revenue_decimal_display?: unknown } | null)?.revenue_decimal_display ?? display;
  let normalized: RevenueDecimalDisplayMode = display;
  try {
    normalized = parseRevenueDecimalDisplay(savedRaw);
  } catch {
    normalized = display;
  }

  return apiJsonOk({ revenue_decimal_display: normalized, configured: true as const });
}
