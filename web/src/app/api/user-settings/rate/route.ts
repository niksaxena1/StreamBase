import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RATE_PER_K_USD = 2.0;

function isSchemaMissing(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

function parseRatePerK(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) throw new Error("Rate must be a number.");
  if (n < 0) throw new Error("Rate must be a non-negative number.");
  // Up to 2 decimals.
  if (!/^\d+(\.\d{1,2})?$/.test(String(raw ?? "").trim()) && !Number.isInteger(n * 100)) {
    throw new Error("Rate can have up to 2 decimal places.");
  }
  return Math.round(n * 100) / 100;
}

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("stream_payout_rate_per_k_usd")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { stream_payout_rate_per_k_usd: DEFAULT_RATE_PER_K_USD, configured: false },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rate = Number((settings as any)?.stream_payout_rate_per_k_usd ?? DEFAULT_RATE_PER_K_USD);
  return NextResponse.json(
    { stream_payout_rate_per_k_usd: Number.isFinite(rate) ? rate : DEFAULT_RATE_PER_K_USD, configured: true },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let ratePerK: number;
  try {
    ratePerK = parseRatePerK((body as any)?.stream_payout_rate_per_k_usd ?? (body as any)?.rate ?? (body as any)?.value);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid rate." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, stream_payout_rate_per_k_usd: ratePerK }], { onConflict: "user_id" })
    .select("stream_payout_rate_per_k_usd")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Rate setting isn’t configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const saved = Number((upserted as any)?.stream_payout_rate_per_k_usd ?? ratePerK);
  return NextResponse.json(
    { stream_payout_rate_per_k_usd: Number.isFinite(saved) ? saved : ratePerK, configured: true },
    { status: 200 },
  );
}

