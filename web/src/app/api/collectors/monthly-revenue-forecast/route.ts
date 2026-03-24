import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

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
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const collector = parseCollector(searchParams.get("collector"));
  if (!collector) return apiJsonErr("missing collector", 400);

  const svc = supabaseService();
  const { data, error } = await svc
    .from("collector_monthly_actual_revenue")
    .select("collector,month,amount_usd,updated_at")
    .eq("collector", collector)
    .order("month", { ascending: true });

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ ok: true as const, items: [], configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const items = (data ?? []).map((r: Record<string, unknown>) => ({
    collector: String(r.collector ?? "").toUpperCase(),
    month: String(r.month ?? ""),
    amount_usd: r.amount_usd == null ? null : Number(r.amount_usd),
    updated_at: r.updated_at ?? null,
  }));

  return apiJsonOk({ ok: true as const, items });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const body = await readJsonBodyOptional(req);
  const collector = parseCollector(body.collector);
  const month = String(body.month ?? "").trim();
  let amountUsd: number | null = null;
  try {
    amountUsd = parseAmountUsdOrNull(body.amount_usd ?? body.amountUsd ?? body.value);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid amount.", 400);
  }

  if (!collector) return apiJsonErr("missing collector", 400);
  if (!isMonthKey(month)) return apiJsonErr("invalid month (expected YYYY-MM)", 400);

  const svc = supabaseService();

  if (amountUsd == null) {
    const { error } = await svc.from("collector_monthly_actual_revenue").delete().eq("collector", collector).eq("month", month);
    if (error) {
      if (isSchemaMissing(error)) {
        return apiJsonErr(
          "Monthly revenue overlay isn’t configured in the database yet. Apply migrations, then retry.",
          503,
        );
      }
      return apiJsonErr(error.message, 500);
    }
    return apiJsonOk({ ok: true as const, cleared: true as const });
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

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Monthly revenue overlay isn’t configured in the database yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const row = data as Record<string, unknown> | null;
  return apiJsonOk({
    ok: true as const,
    item: {
      collector: String(row?.collector ?? collector).toUpperCase(),
      month: String(row?.month ?? month),
      amount_usd: row?.amount_usd == null ? amountUsd : Number(row.amount_usd),
      updated_at: row?.updated_at ?? null,
    },
  });
}
