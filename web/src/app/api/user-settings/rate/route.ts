import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RATE_PER_K_USD = 2.0;

function parseRatePerK(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) throw new Error("Rate must be a number.");
  if (n < 0) throw new Error("Rate must be a non-negative number.");
  if (!/^\d+(\.\d{1,2})?$/.test(String(raw ?? "").trim()) && !Number.isInteger(n * 100)) {
    throw new Error("Rate can have up to 2 decimal places.");
  }
  return Math.round(n * 100) / 100;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("stream_payout_rate_per_k_usd")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ stream_payout_rate_per_k_usd: DEFAULT_RATE_PER_K_USD, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const rate = Number((settings as { stream_payout_rate_per_k_usd?: unknown } | null)?.stream_payout_rate_per_k_usd ?? DEFAULT_RATE_PER_K_USD);
  return apiJsonOk({
    stream_payout_rate_per_k_usd: Number.isFinite(rate) ? rate : DEFAULT_RATE_PER_K_USD,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let ratePerK: number;
  try {
    ratePerK = parseRatePerK(body.stream_payout_rate_per_k_usd ?? body.rate ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid rate.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, stream_payout_rate_per_k_usd: ratePerK }], { onConflict: "user_id" })
    .select("stream_payout_rate_per_k_usd")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Rate setting isn’t configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const saved = Number((upserted as { stream_payout_rate_per_k_usd?: unknown } | null)?.stream_payout_rate_per_k_usd ?? ratePerK);
  return apiJsonOk({
    stream_payout_rate_per_k_usd: Number.isFinite(saved) ? saved : ratePerK,
    configured: true as const,
  });
}
