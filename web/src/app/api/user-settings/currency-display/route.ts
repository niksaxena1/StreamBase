import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { CurrencyDisplay } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSchemaMissing(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

function parseCurrency(raw: unknown): CurrencyDisplay {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "USD" || s === "AED") return s;
  throw new Error("Currency must be USD or AED.");
}

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("currency_display")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json({ currency_display: "USD", configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (settings as any)?.currency_display ?? "USD";
  let normalized: CurrencyDisplay = "USD";
  try {
    normalized = parseCurrency(raw);
  } catch {
    normalized = "USD";
  }

  return NextResponse.json({ currency_display: normalized, configured: true }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let currency: CurrencyDisplay;
  try {
    currency = parseCurrency((body as any)?.currency_display ?? (body as any)?.currency ?? (body as any)?.value);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid currency." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, currency_display: currency }], { onConflict: "user_id" })
    .select("currency_display")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Currency setting isn’t configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const savedRaw = (upserted as any)?.currency_display ?? currency;
  let normalized: CurrencyDisplay = currency;
  try {
    normalized = parseCurrency(savedRaw);
  } catch {
    normalized = currency;
  }

  return NextResponse.json({ currency_display: normalized, configured: true }, { status: 200 });
}

