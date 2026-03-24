import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

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
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("chart_zoom_daily_y_axis,chart_zoom_daily_y_axis_collector_comparison")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        chart_zoom_daily_y_axis: DEFAULT_ZOOM_DAILY,
        chart_zoom_daily_y_axis_collector_comparison: DEFAULT_ZOOM_COLLECTOR_COMPARISON,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const zoomDaily = (settings as { chart_zoom_daily_y_axis?: unknown } | null)?.chart_zoom_daily_y_axis;
  const zoomCollector = (settings as { chart_zoom_daily_y_axis_collector_comparison?: unknown } | null)
    ?.chart_zoom_daily_y_axis_collector_comparison;

  return apiJsonOk({
    chart_zoom_daily_y_axis: typeof zoomDaily === "boolean" ? zoomDaily : DEFAULT_ZOOM_DAILY,
    chart_zoom_daily_y_axis_collector_comparison:
      typeof zoomCollector === "boolean" ? zoomCollector : DEFAULT_ZOOM_COLLECTOR_COMPARISON,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let zoomDaily: boolean;
  let zoomCollector: boolean;
  try {
    zoomDaily = parseBool(body.chart_zoom_daily_y_axis ?? body.zoom_daily ?? body.enabled);
    zoomCollector = parseBool(
      body.chart_zoom_daily_y_axis_collector_comparison ?? body.zoom_collector_comparison ?? body.collector_comparison_enabled,
    );
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid value.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [
        {
          user_id: auth.user.id,
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
      return apiJsonErr("Chart axis zoom settings aren’t configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const savedDaily = (upserted as { chart_zoom_daily_y_axis?: unknown } | null)?.chart_zoom_daily_y_axis;
  const savedCollector = (upserted as { chart_zoom_daily_y_axis_collector_comparison?: unknown } | null)
    ?.chart_zoom_daily_y_axis_collector_comparison;

  return apiJsonOk({
    chart_zoom_daily_y_axis: typeof savedDaily === "boolean" ? savedDaily : zoomDaily,
    chart_zoom_daily_y_axis_collector_comparison:
      typeof savedCollector === "boolean" ? savedCollector : zoomCollector,
    configured: true as const,
  });
}
