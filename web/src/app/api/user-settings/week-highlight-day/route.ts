import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAY = 0; // Sunday (UTC)

function isSchemaMissing(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

function parseDayIndex(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) throw new Error("Day must be a number (0-6).");
  const i = Math.trunc(n);
  if (i < 0 || i > 6) throw new Error("Day must be between 0 and 6.");
  return i;
}

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_week_highlight_day")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json({ chart_week_highlight_day: DEFAULT_DAY, configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const day = Number((settings as any)?.chart_week_highlight_day ?? DEFAULT_DAY);
  const normalized = Number.isFinite(day) && day >= 0 && day <= 6 ? Math.trunc(day) : DEFAULT_DAY;
  return NextResponse.json({ chart_week_highlight_day: normalized, configured: true }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let day: number;
  try {
    day = parseDayIndex((body as any)?.chart_week_highlight_day ?? (body as any)?.day ?? (body as any)?.value);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid day." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, chart_week_highlight_day: day }], { onConflict: "user_id" })
    .select("chart_week_highlight_day")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            "Week highlight day setting isn’t configured in the database yet. Add the `chart_week_highlight_day` column to `user_settings`, then retry.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const saved = Number((upserted as any)?.chart_week_highlight_day ?? day);
  const normalized = Number.isFinite(saved) && saved >= 0 && saved <= 6 ? Math.trunc(saved) : day;
  return NextResponse.json({ chart_week_highlight_day: normalized, configured: true }, { status: 200 });
}

