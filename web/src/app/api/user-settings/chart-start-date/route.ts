import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { DEFAULT_CHART_START_DATE_ISO, normalizeIsoDateOrNull } from "@/components/charts/chartUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIsoDateOrNull(raw: unknown): string | null {
  // Allow null/empty to mean "unset" (falls back to DEFAULT on read).
  if (raw == null) return null;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const norm = normalizeIsoDateOrNull(s);
  if (!norm) throw new Error("Date must be in YYYY-MM-DD format.");
  return norm;
}

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_start_date")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { chart_start_date: DEFAULT_CHART_START_DATE_ISO, configured: false },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (settings as any)?.chart_start_date ?? null;
  const normalized = normalizeIsoDateOrNull(raw) ?? DEFAULT_CHART_START_DATE_ISO;
  return NextResponse.json({ chart_start_date: normalized, configured: true }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let chartStartDate: string | null;
  try {
    chartStartDate = parseIsoDateOrNull(
      (body as any)?.chart_start_date ?? (body as any)?.chartStartDate ?? (body as any)?.value,
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid date." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, chart_start_date: chartStartDate }], { onConflict: "user_id" })
    .select("chart_start_date")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Chart start date setting isn’t configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const savedRaw = (upserted as any)?.chart_start_date ?? chartStartDate;
  const normalized = normalizeIsoDateOrNull(savedRaw) ?? DEFAULT_CHART_START_DATE_ISO;
  return NextResponse.json({ chart_start_date: normalized, configured: true }, { status: 200 });
}

