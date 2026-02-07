import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ZOOM_DAILY = true;
const DEFAULT_ZOOM_COLLECTOR_COMPARISON = true;

function parseBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) throw new Error("Value must be a boolean.");
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  throw new Error("Value must be a boolean.");
}

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_zoom_daily_y_axis,chart_zoom_daily_y_axis_collector_comparison")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          chart_zoom_daily_y_axis: DEFAULT_ZOOM_DAILY,
          chart_zoom_daily_y_axis_collector_comparison: DEFAULT_ZOOM_COLLECTOR_COMPARISON,
          configured: false,
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const zoomDaily = (settings as any)?.chart_zoom_daily_y_axis;
  const zoomCollector = (settings as any)?.chart_zoom_daily_y_axis_collector_comparison;

  return NextResponse.json(
    {
      chart_zoom_daily_y_axis: typeof zoomDaily === "boolean" ? zoomDaily : DEFAULT_ZOOM_DAILY,
      chart_zoom_daily_y_axis_collector_comparison:
        typeof zoomCollector === "boolean" ? zoomCollector : DEFAULT_ZOOM_COLLECTOR_COMPARISON,
      configured: true,
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let zoomDaily: boolean;
  let zoomCollector: boolean;
  try {
    zoomDaily = parseBool(
      (body as any)?.chart_zoom_daily_y_axis ?? (body as any)?.zoom_daily ?? (body as any)?.enabled,
    );
    zoomCollector = parseBool(
      (body as any)?.chart_zoom_daily_y_axis_collector_comparison ??
        (body as any)?.zoom_collector_comparison ??
        (body as any)?.collector_comparison_enabled,
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid value." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [
        {
          user_id: user.id,
          chart_zoom_daily_y_axis: zoomDaily,
          chart_zoom_daily_y_axis_collector_comparison: zoomCollector,
        },
      ],
      { onConflict: "user_id" },
    )
    .select("chart_zoom_daily_y_axis,chart_zoom_daily_y_axis_collector_comparison")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Chart axis zoom settings aren’t configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const savedDaily = (upserted as any)?.chart_zoom_daily_y_axis;
  const savedCollector = (upserted as any)?.chart_zoom_daily_y_axis_collector_comparison;

  return NextResponse.json(
    {
      chart_zoom_daily_y_axis: typeof savedDaily === "boolean" ? savedDaily : zoomDaily,
      chart_zoom_daily_y_axis_collector_comparison:
        typeof savedCollector === "boolean" ? savedCollector : zoomCollector,
      configured: true,
    },
    { status: 200 },
  );
}

