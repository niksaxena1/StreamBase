import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import type { CurrencyDisplay } from "@/lib/format";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCurrency(raw: unknown): CurrencyDisplay {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "USD" || s === "AED") return s;
  throw new Error("Currency must be USD or AED.");
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("currency_display")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ currency_display: "USD" as const, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const raw = (settings as { currency_display?: unknown } | null)?.currency_display ?? "USD";
  let normalized: CurrencyDisplay = "USD";
  try {
    normalized = parseCurrency(raw);
  } catch {
    normalized = "USD";
  }

  return apiJsonOk({ currency_display: normalized, configured: true as const });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let currency: CurrencyDisplay;
  try {
    currency = parseCurrency(body.currency_display ?? body.currency ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid currency.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, currency_display: currency }], { onConflict: "user_id" })
    .select("currency_display")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Currency setting isn’t configured in the database yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const savedRaw = (upserted as { currency_display?: unknown } | null)?.currency_display ?? currency;
  let normalized: CurrencyDisplay = currency;
  try {
    normalized = parseCurrency(savedRaw);
  } catch {
    normalized = currency;
  }

  return apiJsonOk({ currency_display: normalized, configured: true as const });
}
