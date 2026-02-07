import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMonthKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

function parseCollector(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

function parseAmountUsdOrNull(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("Amount must be a number.");
  if (n < 0) throw new Error("Amount must be >= 0.");
  return n;
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ ok: false, error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const collector = parseCollector(searchParams.get("collector"));
  if (!collector) return NextResponse.json({ ok: false, error: "missing collector" }, { status: 400 });

  const svc = supabaseService();
  const { data, error } = await svc
    .from("collector_monthly_actual_revenue")
    .select("collector,month,amount_usd,updated_at")
    .eq("collector", collector)
    .order("month", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? []).map((r: any) => ({
    collector: String(r.collector ?? "").toUpperCase(),
    month: String(r.month ?? ""),
    amount_usd: r.amount_usd == null ? null : Number(r.amount_usd),
    updated_at: r.updated_at ?? null,
  }));

  return NextResponse.json({ ok: true, items }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ ok: false, error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const collector = parseCollector(body?.collector);
  const month = String(body?.month ?? "").trim();
  let amountUsd: number | null = null;
  try {
    amountUsd = parseAmountUsdOrNull(body?.amount_usd ?? body?.amountUsd ?? body?.value);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Invalid amount." }, { status: 400 });
  }

  if (!collector) return NextResponse.json({ ok: false, error: "missing collector" }, { status: 400 });
  if (!isMonthKey(month)) return NextResponse.json({ ok: false, error: "invalid month (expected YYYY-MM)" }, { status: 400 });

  const svc = supabaseService();

  // Clear (delete) when amount is null.
  if (amountUsd == null) {
    const { error } = await svc
      .from("collector_monthly_actual_revenue")
      .delete()
      .eq("collector", collector)
      .eq("month", month);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: true }, { status: 200 });
  }

  const { data, error } = await svc
    .from("collector_monthly_actual_revenue")
    .upsert(
      [
        {
          collector,
          month,
          amount_usd: amountUsd,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        },
      ],
      { onConflict: "collector,month" },
    )
    .select("collector,month,amount_usd,updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      ok: true,
      item: {
        collector: String((data as any)?.collector ?? collector).toUpperCase(),
        month: String((data as any)?.month ?? month),
        amount_usd: (data as any)?.amount_usd == null ? amountUsd : Number((data as any).amount_usd),
        updated_at: (data as any)?.updated_at ?? null,
      },
    },
    { status: 200 },
  );
}

